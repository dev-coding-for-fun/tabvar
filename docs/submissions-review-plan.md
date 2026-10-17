# Submissions review plan

Status: proposed. No application changes yet.

## The idea

Proposed data changes wait in a queue table until an admin decides on them. Approval writes them to the main tables.

1. **In:** a client posts a submission, which is a list of creates and edits to crags, sectors, routes, and topos.
2. **Wait:** it's stored as one row in `submission`. Nothing is published.
3. **Review:** `/admin/submissions` shows each change. Edits show current → proposed, and conflicts found in the audit log are flagged.
4. **Approve:** the changes are written to the main tables in order, each one writes an audit row, and the submission row is deleted. **Reject:** the changes are recorded in the audit log as rejected, and the submission row is deleted.

The `submission` table is only a queue. The [audit log](#audit-log) is the only history.

Issue reports keep their existing moderation (`In Moderation` status). They'll get a tab on the same page later, but they don't use the submission table.

## Table

`topo_submission` is empty and unused. Replace it with `submission`. A row exists only while the submission is waiting for a decision.

| Column | Notes |
| :--- | :--- |
| `id` | TEXT uuid |
| `uid` | Submitter |
| `source` | e.g. `topobuilder` |
| `payload` | JSON; format below |
| `error` | Set when an approval attempt failed |
| `created_at` | |

## Payload

An ordered list of changes. Each change creates or edits one record.

```json
{
  "changes": [
    { "ref": "c1", "entity": "crag", "op": "create", "fields": { "name": "New Crag" } },
    { "ref": "s1", "entity": "sector", "op": "create", "fields": { "name": "Main Wall", "cragId": "c1" } },
    { "ref": "r1", "entity": "route", "op": "create", "fields": { "name": "New Line", "sectorId": "s1", "gradeYds": "5.11a" } },
    { "entity": "route", "op": "update", "id": 456, "baseUpdatedAt": "2026-06-09 10:00:00", "fields": { "boltCount": 7 } },
    { "entity": "topo", "op": "create", "fields": {
      "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "name": "Main Wall Left", "sectorId": "s1",
      "background": "file:bg", "raster": "file:raster", "annotations": { "version": 1, "elements": [] },
      "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "r1", "label": "2" }]
    } }
  ]
}
```

- **Fields** use the sync API's camelCase names. Each entity has a fixed list of editable fields, and intake rejects anything else:
  - crag: `name`, `notes`, `latitude`, `longitude`
  - sector: `name`, `cragId`, `notes`, `latitude`, `longitude`, `sortOrder`
  - route: `name`, `altNames`, `sectorId`, `gradeYds`, `climbStyle`, `boltCount`, `pitchCount`, `routeLength`, `firstAscentBy`, `firstAscentDate`, `routeBuiltDate`, `year`, `status`, `notes`, `sortOrder`, `latitude`, `longitude`
  - topo: `uuid`, `name`, `description`, `cragId`, `sectorId`, `latitude`, `longitude`, `status`, `annotations`, `background`, `raster`, `routes`
- **Edits** carry only the fields being changed. `null` clears a field.
- **Parent IDs** (`cragId`, `sectorId`, `routeId`) are either an existing numeric ID or the `ref` of an earlier create in the same submission.
- **`baseUpdatedAt`** is the record's `updatedAt` as the submitter last saw it. It's optional and used only for [conflict checks](#conflicts).
- **Files** are multipart parts referenced as `file:<part name>`. Intake stores them in R2 under `submissions/<id>/` and replaces each placeholder with the stored file's URL before saving the payload. From then on, the payload and any audit rows point at real files.
- **No deletes:** retire a route or topo by setting `status`. Moves and reordering are ordinary edits to `cragId`, `sectorId`, or `sortOrder`. Existing DB triggers keep denormalized names, search, and issue crag IDs in sync.

## Intake

Keep `POST /api/topobuilder/submissions` and change it to the new payload. It checks:

- the entity and op are known;
- every field is on the entity's list;
- each edit target exists;
- each `ref` points to an earlier create;
- every referenced file is present and is an image.

Bad input returns 400 with a message, and storage or DB failures return 500.

`GET /api/topobuilder/submissions?id=` reports on one of the caller's own submissions:

- While its row exists, it returns `pending`, plus the error from any failed approval attempt.
- After a decision, it reads the audit rows with that `submission_id` and `author_uid`. It returns `approved` or `rejected`, and on approval the ID created for each `ref`, so TopoBuilder can link its local records.

`POST /api/v1/topos` lets any member publish topos and new routes directly, and soft-delete any topo. Restrict its writes to admin/super so member changes go through submissions. Admin and super edits in the crag editor stay direct and unchanged.

## Approve and reject

Approve runs through the changes in order:

- **create:** insert the row, then write its new ID onto the change (`"id": 789`) so later changes can resolve the `ref`. New crags get a slug from `slugifyUnique`, the same as the crag page does.
- **update:** set only the fields in the change.
- **topo:** call the existing `saveRawTopo` with the stored image URLs and the resolved route IDs.

Each applied change writes an audit row as soon as it succeeds. When every change has succeeded, delete the submission row.

If a change fails, stop. Save the payload with the IDs created so far, set `error`, and keep the row in the queue. Approving again skips creates that already have an ID, and doesn't write their audit rows a second time. Rejecting at that point doesn't undo the changes that were already applied.

Reject writes one audit row per remaining change with `decision = 'rejected'`, then deletes the row. It doesn't touch the main tables. Uploaded files stay in R2, so rejected audit rows still point at them.

Each submission is approved or rejected as a whole. To accept part of one, reject it and make the edit by hand in the crag editor.

## Conflicts

These are checked for each `update` when a submission is opened. Creates have no existing record, so they aren't checked.

The **base time** is the change's `baseUpdatedAt` (when the submitter last saw the record), or the submission's `created_at` if no `baseUpdatedAt` was sent.

1. **Field conflict:** the audit log has a change to this record after the base time, and that change touched a field this submission edits. Only applied changes count, meaning direct edits and approved changes. Rejected rows don't count, and neither do rows from this same submission (left by an earlier, partly failed approval). The conflict shows the field, who changed it, when, and its before → after values.
2. **Overlap:** another queued submission edits the same field on the same record. The conflict links to that submission. Only fields are compared, not values: two submissions proposing the same value are rare and get no special handling.
3. **Record changed since submitted** (a warning, not a conflict): the record changed after the base time, but not on any field this submission edits. This covers two cases:
   - The audit log shows changes only to other fields. The warning lists them.
   - `updated_at` is later than the base time with no audit row to explain it. That can come from the bulk JSON import, Sloper sync, changes made before the audit log existed, or triggers bumping `updated_at` when a photo or topo link changes. The warning says the cause isn't recorded.

   Either way, a record moving underneath a submission is unusual and worth a closer look.

Conflicts and the warning appear together in a conflict section on the affected change's card. Conflicts are marked as conflicts, the warning in a lighter style, and the submission's list entry shows a count. They never block approval and nothing resolves them automatically; the reviewer decides. The live current → proposed diff still shows the values that would actually be replaced.

Compare timestamps in one format, UTC `YYYY-MM-DD HH:MM:SS`. Most rows use that, but some write paths store ISO strings, and `baseUpdatedAt` comes from the sync API. An audit row is written just after the change it records, so its `created_at` can be a second or two later than the `updated_at` the submitter saw. Only count audit rows more than a few seconds after the base time, so the submitter's own starting point isn't flagged.

## Audit log

The audit log is one table for manual investigation and tracing, and it's the only history of route-data changes. App code writes a row for every crag, sector, route, or topo change, and for every change in a rejected submission. It has no UI; read it with SQL on `/admin/query`.

| Column | Notes |
| :--- | :--- |
| `id` | INTEGER autoincrement |
| `created_at` | When the change was written or rejected |
| `author_uid`, `author_name` | Who made or proposed the change: the submitter, or the editor for a direct edit |
| `reviewer_uid`, `reviewer_name` | Who approved or rejected it. `null` for a direct edit. |
| `decision` | `approved`, `rejected`, or `null` for a direct edit |
| `source` | The submission's source (e.g. `topobuilder`). For a direct edit, `web` or `api`. |
| `entity` | `crag`, `sector`, `route`, or `topo` |
| `entity_id` | `null` for a rejected create |
| `action` | `create`, `update`, or `delete` |
| `changes` | JSON `{ "column": [before, after] }` for the changed columns only. Creates have `null` before values. Deletes store the whole row as the before value. For a rejected change, `after` is the proposed value, which was never applied. |
| `submission_id` | Set when the change came from a submission. It groups that submission's rows after the submission row is deleted. |
| `ref` | The change's `ref` for a create from a submission. Lets the status GET map refs to new IDs. |

Each row stores everything worth keeping about a change, because a decided submission row is deleted. The uid and name columns have no foreign key, so rows survive account deletion, the same as `issue_audit_log`. A submission's time of arrival isn't kept; `created_at` is the time of the decision.

Index `(entity, entity_id)`, `(author_uid)`, and `(submission_id)`.

```sql
SELECT * FROM audit_log WHERE entity = 'route' AND entity_id = 456 ORDER BY id DESC;
SELECT * FROM audit_log WHERE author_uid = 'abc123' ORDER BY id DESC;
SELECT * FROM audit_log WHERE submission_id = '…' ORDER BY id;
```

A single `writeAudit` helper in `app/lib/audit.server.ts` inserts the rows. It's called from:

- **Approval and rejection:** one row per change. The author is the submission's `uid` and the reviewer is the admin who decided. Before values come from the same read the review diff uses.
- **The crag editor action (`topos.$crag.tsx`) and the crag create and position actions (`topos._index.tsx`):** the author is the signed-in editor, with source `web`. Read the row before each update or delete.
- **`/api/v1/topos` writes:** the author is the token's user, with source `api`. `saveRawTopo` already receives this `uid` but ignores it today; pass it through to `writeAudit`.

The submitter is already recorded for submissions: intake stores the API token's user as `uid`. Direct writes record no author anywhere today, because crags, sectors, routes, and topos have no creator column. The audit log fills that gap from now on without adding columns to the main tables. Changes made before it exists stay unattributed.

These aren't logged:

- the bulk JSON import and Sloper sync;
- rows that DB triggers change, such as a route's `sector_name` after a sector rename. The sector's own row covers it.

Issues and attachments keep their existing audit logs.

Logging lives in app code rather than SQLite triggers for two reasons: triggers can't tell who made a change, and the existing `updated_at` and denormalization triggers would fill the log with noise.

## Review page

Rebuild `/admin/submissions`. Access stays admin/super.

- **Route data tab:** queued submissions, newest first, showing submitter, source, time, and counts of creates and edits. To see past decisions, query the audit log.
- **Detail:** one card per change.
  - Creates list their fields.
  - Edits show current → proposed for the changed fields only, read live from the main tables.
  - Topos show the raster image and the routes they link.
  - Conflicts and the record-changed warning appear in a conflict section on the affected card.
- **Actions:** Approve and Reject. If an approval failed, show its error.
- **Issues tab (later):** `In Moderation` issues, using the existing actions and components from `/issues/manage`.

## Left out

These are left out on purpose:

- per-change tables;
- keeping decided submissions, or any history outside the audit log;
- an audit log viewer or retention policy;
- partial approval or field merging;
- bulk approve;
- deletes;
- photo attachments from `api.attachments`, which stay as they are;
- an AI producer;
- detecting duplicate creates, such as two submissions adding the same route (see [Future: name matching](#future-name-matching)).

Add any of these only when they're actually needed.

## Future: name matching

Phase after this plan: fuzzy name matching to catch creates that duplicate an existing or queued record, such as "Me and My Shadow" vs. "Me & My Shadow" in the same sector. It would flag likely duplicates on the review page. It's deliberately not part of the conflict checks above, so don't add name comparisons there in the meantime.

## Steps

1. Audit log: a migration (next free number) that creates `audit_log`, then `npm run typegen`, the `writeAudit` helper, and calls from the crag editor, the crag create and position actions, and `/api/v1/topos`. It doesn't depend on submissions, so it's useful for admin edits right away.
2. Migration that drops `topo_submission` and creates `submission`. Apply it locally, run `npm run typegen`, and update user deletion in `users._index.tsx` and its test so it deletes only the user's queued submissions.
3. Payload validation, the intake endpoint (including the swap from file placeholders to URLs), and the status GET.
4. Approve and reject, including audit rows and deleting the decided row.
5. Review page.
6. Conflict checks against the audit log and other queued submissions, shown on the review page.
7. TopoBuilder (`../topobuilder`): send the new payload and read back the created IDs. The payload includes linked routes by ID, edits as changed fields only, `baseUpdatedAt`, and topo images and annotations. Ship this together with step 3.
8. Restrict `/api/v1/topos` writes to admin/super, and update `docs/topo-sync-api.md` and `docs/route-sync-api.md`.
9. Issues tab.

## Tests

Focused Vitest tests using `app/test/helpers.ts`:

- intake rejects unknown fields, bad refs, missing files, and missing edit targets, and saves stored URLs in place of file placeholders;
- approving a crag → sector → route → topo submission creates every record with the right parents;
- an edit changes only its own fields;
- a failed approval stays queued, and approving again doesn't duplicate creates or audit rows;
- a field conflict is found from an applied audit row after the base time, but not from rejected rows, rows from the same submission, or rows within the few-second slack;
- an overlap with another queued submission on the same field is found;
- a record changed only on other fields, or with a newer `updated_at` and no audit row, gets the record-changed warning instead of a conflict;
- ISO and SQLite timestamps compare correctly;
- crag editor edits write audit rows containing only the changed columns, with the editor as author and no reviewer, and deletes store the whole row;
- approvals and rejections write one audit row per change, with the submitter as author and the deciding admin as reviewer, and delete the submission row;
- after a decision, the status GET reports the outcome and the created IDs from the audit log;
- only admin/super can approve, and members can't write through `/api/v1/topos`.

Run `npm run verify` after each step, and run `npm run build` for the API and UI changes.
