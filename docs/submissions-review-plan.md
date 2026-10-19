# Submissions review plan

Status: steps 1–6, 8 and 10 are built. TopoBuilder (step 7) and the issues tab (step 9) remain.

## The idea

Proposed data changes wait in a table until an admin decides on them. Approval writes them to the main tables.

1. **In:** a client proposes objects: new crags, sectors, routes, and topos under its own IDs, and edits to existing records.
2. **Wait:** each object is one row in `submission`, holding the account's latest proposal for it. Nothing is published.
3. **Review:** `/admin/submissions` shows an account's linked objects together as one item. Edits show current → proposed, and conflicts found in the audit log are flagged.
4. **Approve:** each object is written to the main tables, parents first, its row is marked `published` with the record's ID, and an audit row is written. **Reject:** each object is recorded in the audit log as rejected, and its row is marked `rejected`.

A row keeps only the account's latest proposal and, once published, the link from the client's ID to the record. The [audit log](#audit-log) is the history of what was decided.

Issue reports keep their existing moderation (`In Moderation` status). They'll get a tab on the same page later, but they don't use the submission table.

## Why per object

Users will send the same things more than once, in any shape: a whole crag, then each of its sectors; single routes; retries after a lost response; a resubmit after approval because the app never adopted the new IDs. Every one of those should just work, with no duplicate records and nothing lost, whether or not the app tracks what it sent.

Each object already carries its relationships (`cragId`, `sectorId`, a topo's `routes`), so the unit of identity is the **object**, not a set of changes. One row per account and object gives that directly:

- sending an object again updates its row, whatever else is in the request;
- a published object's row remembers its record, so it's never created twice;
- a partly failed approval leaves each object either published or pending, with nothing to resume by hand.

## Table

| Column | Notes |
| :--- | :--- |
| `id` | INTEGER autoincrement |
| `uid` | The proposing account |
| `source` | e.g. `topobuilder` |
| `entity` | `crag`, `sector`, `route`, or `topo` |
| `ref` | The client's own ID for an object it proposed; `null` for an edit of someone else's record |
| `target_id` | The record: `null` for a new object until it's published |
| `fields` | JSON; the proposed fields, in the format below |
| `base_updated_at` | The record's `updatedAt` as the submitter last saw it (edits) |
| `state` | `pending`, `published`, or `rejected` |
| `error` | Set when an approval attempt failed |
| `received_at` | When the latest version of the proposal arrived |
| `decided_at` | When it was approved or rejected |
| `updated_at` | Any change to the row; the cursor for "my objects" |

Unique indexes on `(uid, ref)` and `(uid, entity, target_id)` keep one row per account and object. Rows belong to the account and are deleted with it; the audit log keeps the decisions.

## Request

```json
{
  "objects": [
    { "entity": "crag", "ref": "c1", "fields": { "name": "New Crag" } },
    { "entity": "sector", "ref": "s1", "fields": { "name": "Main Wall", "cragId": "c1" } },
    { "entity": "route", "ref": "r1", "fields": { "name": "New Line", "sectorId": "s1", "gradeYds": "5.11a" } },
    { "entity": "route", "id": 456, "baseUpdatedAt": "2026-06-09 10:00:00", "fields": { "boltCount": 7 } },
    { "entity": "topo", "ref": "t1", "fields": {
      "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "name": "Main Wall Left", "sectorId": "s1",
      "background": "file:bg", "raster": "file:raster", "annotations": { "version": 1, "items": [] },
      "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "r1", "label": "2" }]
    } },
    { "entity": "route", "ref": "r9", "withdraw": true }
  ]
}
```

- **Identity:** an object is either the client's own (`ref`, stable and unique within the account) or an existing record (`id`). Identity is per account: two accounts' objects never merge, and when they edit the same record, the conflict checks flag it.
- **Fields** use the sync API's camelCase names. Each entity has a fixed list of editable fields, and intake rejects anything else:
  - crag: `name`, `notes`, `latitude`, `longitude`
  - sector: `name`, `cragId`, `notes`, `latitude`, `longitude`, `sortOrder`
  - route: `name`, `altNames`, `sectorId`, `gradeYds`, `climbStyle`, `boltCount`, `pitchCount`, `routeLength`, `firstAscentBy`, `firstAscentDate`, `routeBuiltDate`, `year`, `status`, `notes`, `sortOrder`, `latitude`, `longitude`
  - topo: `uuid`, `name`, `description`, `cragId`, `sectorId`, `latitude`, `longitude`, `status`, `annotations`, `background`, `raster`, `routes`
- **Only changed fields** are sent. `null` clears a field.
- **References** (`cragId`, `sectorId`, a topo's `routes[].routeId`, annotation items' `routeId`) are an existing numeric ID or the `ref` of one of the account's objects.
- **Files** are multipart parts referenced as `file:<part name>`. Intake stores them in R2 under `submissions/<uid>/`, content-hashed, and saves the stored URL in place of each placeholder. From then on, rows and audit rows point at real files.
- **No deletes:** retire a route or topo by setting `status`. Moves and reordering are ordinary edits to `cragId`, `sectorId`, or `sortOrder`. Existing DB triggers keep denormalized names, search, and issue crag IDs in sync.

## Intake

`POST /api/topobuilder/submissions` handles each object in the request against the account's row for it:

1. **Check the shape:** entity, `ref` or `id` (not both), known fields, files present and images.
2. **Merge.** A new version is merged into the pending proposal **field by field, and the newest value wins**; omitted fields keep the earlier value. A pending row's `received_at` becomes now. A published or rejected row starts a fresh proposal.
3. **Published objects become edits.** A `ref` whose row is published proposes an edit of its record. If none of its fields differ from the record, nothing is queued and it's reported as `unchanged`; including an unchanged published parent is free.
4. **Withdraw.** `withdraw: true` takes the object out of review: a new object's row is deleted, and a published object's row goes back to `published`. This is the only way to remove something.
5. **Resolve published refs.** References to the account's published objects are stored as their record IDs.
6. **Validate the result**, including the account's other pending objects that point at what changed:
   - every `ref` reference names a pending or published object of the right entity;
   - edit targets exist;
   - new objects have their required fields;
   - a topo `uuid` that belongs to another topo is refused, with the ID to edit instead;
   - an object appears at most once per request.

Bad input returns 400 with up to 10 problems, and nothing is stored. Storage or DB failures return 500. Success returns 200 with each object's `ref`, `id`, and `state` (`pending`, `unchanged`, or `withdrawn`).

`GET /api/topobuilder/submissions?since=` lists the caller's own objects changed since the cursor, for every role, so the app can show what's in review and adopt record IDs. An all-objects view for admins isn't needed in the app; reviewing happens on the web. The client contract is in [submissions-api.md](submissions-api.md).

`/api/v1/topos` writes (`POST`, `DELETE`) are limited to admin/super, so member changes go through submissions. It doesn't create routes as a side effect, and an update keeps the fields it leaves out. See [topo-sync-api.md](topo-sync-api.md). Admin and super edits in the crag editor stay direct and unchanged.

## Approve and reject

The review page groups an account's pending objects into **items**: objects linked by refs, such as a new crag with its new sectors, routes, and topos, form one item; an unrelated edit is an item on its own. An item is approved or rejected as a whole.

Approve runs through the item's objects parents first (crag, sector, route, topo). Objects only reference higher levels, so this order is all the dependency handling there is. For each object:

- references to the account's refs are resolved to record IDs, including annotation `routeId`s;
- a new object is inserted (new crags get a slug from `slugifyUnique`, the same as the crag page does); an edit sets only its fields; topos go through the existing `saveRawTopo`;
- the row is marked `published` with its `target_id`, then the audit row is written.

If an object fails, its row's `error` is set and approval stops. The objects before it are published, and the rest stay pending; approving again continues with them. A crash between a record's insert and its row update can repeat at most that one object.

Reject writes one audit row per object with `decision = 'rejected'` and marks the rows `rejected`. It doesn't touch the main tables. Uploaded files stay in R2, so rejected audit rows still point at them.

To accept part of an item, reject it and make the edit by hand in the crag editor.

## Conflicts

These are checked for each pending edit when an item is opened. New objects have no existing record, so they aren't checked.

The **base time** is the object's `base_updated_at` (when the submitter last saw the record), or its `received_at` if none was sent.

1. **Field conflict:** the audit log has a change to this record after the base time, and that change touched a field this object edits. Only applied changes count, meaning direct edits and approvals; rejected rows don't. The conflict shows the field, who changed it, when, and its before → after values.
2. **Overlap:** another account's pending edit changes the same field on the same record. The conflict links to that item. Only fields are compared, not values: two proposals with the same value are rare and get no special handling.
3. **Record changed since submitted** (a warning, not a conflict): the record changed after the base time, but not on any field this object edits. This covers two cases:
   - The audit log shows changes only to other fields. The warning lists them.
   - `updated_at` is later than the base time with no audit row to explain it. That can come from the bulk JSON import, Sloper sync, changes made before the audit log existed, or triggers bumping `updated_at` when a photo or topo link changes. The warning says the cause isn't recorded.

   Either way, a record moving underneath a proposal is unusual and worth a closer look.

Conflicts and the warning appear together in a conflict section on the affected object's card. Conflicts are marked as conflicts, the warning in a lighter style, and the item's list entry shows a count. They never block approval and nothing resolves them automatically; the reviewer decides. The live current → proposed diff still shows the values that would actually be replaced.

Compare timestamps in one format, UTC `YYYY-MM-DD HH:MM:SS`. Most rows use that, but some write paths store ISO strings, and `baseUpdatedAt` comes from the sync API. An audit row is written just after the change it records, so its `created_at` can be a second or two later than the `updated_at` the submitter saw. Only count audit rows more than a few seconds after the base time, so the submitter's own starting point isn't flagged.

## Audit log

The audit log is one table for manual investigation and tracing, and it's the history of route-data changes. App code writes a row for every crag, sector, route, or topo change, and for every rejected object. It has no UI; read it with SQL on `/admin/query`.

| Column | Notes |
| :--- | :--- |
| `id` | INTEGER autoincrement |
| `created_at` | When the change was written or rejected |
| `author_uid`, `author_name` | Who made or proposed the change: the submitter, or the editor for a direct edit |
| `reviewer_uid`, `reviewer_name` | Who approved or rejected it. `null` for a direct edit. |
| `decision` | `approved`, `rejected`, or `null` for a direct edit |
| `source` | The submission's source (e.g. `topobuilder`). For a direct edit, `web` or `api`. |
| `entity` | `crag`, `sector`, `route`, or `topo` |
| `entity_id` | `null` for a rejected new object |
| `action` | `create`, `update`, or `delete` |
| `changes` | JSON `{ "column": [before, after] }` for the changed columns only. Creates have `null` before values. Deletes store the whole row as the before value. For a rejected object, `after` is the proposed value, which was never applied. |
| `submission_id` | The `submission` row's ID, when the change came from a proposal |
| `ref` | The object's `ref`, when it has one |

Each row stores everything worth keeping about a decision: a row in `submission` holds only the latest proposal, and it's deleted with the account. The uid and name columns have no foreign key, so audit rows survive account deletion, the same as `issue_audit_log`.

Index `(entity, entity_id)`, `(author_uid)`, and `(submission_id)`.

```sql
SELECT * FROM audit_log WHERE entity = 'route' AND entity_id = 456 ORDER BY id DESC;
SELECT * FROM audit_log WHERE author_uid = 'abc123' ORDER BY id DESC;
SELECT * FROM audit_log WHERE submission_id = '42' ORDER BY id;
```

A single `writeAudit` helper in `app/lib/audit.server.ts` inserts the rows. It's called from:

- **Approval and rejection:** one row per object. The author is the row's `uid` and the reviewer is the admin who decided. Before values come from the same read the review diff uses.
- **The crag editor action (`topos.$crag.tsx`) and the crag create and position actions (`topos._index.tsx`):** the author is the signed-in editor, with source `web`. The row is read before each update or delete.
- **`/api/v1/topos` writes:** the author is the token's user, with source `api`.

Crags, sectors, routes, and topos have no creator column, so the audit log is where authorship lives, without adding columns to the main tables. Changes made before it existed stay unattributed.

These aren't logged:

- the bulk JSON import and Sloper sync;
- rows that DB triggers change, such as a route's `sector_name` after a sector rename. The sector's own row covers it.

Issues and attachments keep their existing audit logs.

Logging lives in app code rather than SQLite triggers for two reasons: triggers can't tell who made a change, and the existing `updated_at` and denormalization triggers would fill the log with noise.

## Review page

`/admin/submissions`, admin/super only.

- **List:** pending items, most recently received first, each titled by its first object (`New crag “…”` or `Edit route #…`), with the submitter and counts of new objects and edits, and conflict counts. To see past decisions, query the audit log.
- **Detail:** one card per object.
  - New objects list their fields.
  - Edits show current → proposed for the changed fields only, read live from the main tables, plus how many proposed fields already match.
  - Topos show the raster image and the routes they link.
  - Conflicts and the record-changed warning appear in a conflict section on the affected card.
  - An object whose approval failed shows the error.
- **Actions:** Approve and Reject. After a decision, the next item opens.
- **Issues tab (later):** `In Moderation` issues, using the existing actions and components from `/issues/manage`.

## Scenarios

| What the user does | Result |
| :--- | :--- |
| A crag, then each of its sectors | One proposal per object; the sectors join the crag's review item. |
| Each sector, then the whole crag | The same. |
| A retry after a lost response | Each object's row is updated in place; nothing is duplicated. |
| A resubmit after approval, with IDs never adopted | Changed fields become edits of the published records; unchanged objects are reported `unchanged`. |
| Two unrelated crags | No links between them, so they're separate review items. |
| A route deleted locally | The app withdraws it, and any pending objects that point at it. |
| A rejected object sent again | A fresh proposal. |

### Edge cases accepted

- **Concurrent requests:** two overlapping requests at the same instant from one account can race on the same rows. The app sends them one at a time.
- **Unseen changes:** an admin who has an item open may approve it after the submitter sent a newer version.
- **Other accounts:** duplicates across accounts, such as the same new route proposed by two users, still need the future name matching.

## Left out

These are left out on purpose:

- keeping each version of a proposal, or any history outside the audit log;
- an audit log viewer or retention policy;
- partial approval of an item, or the reviewer editing a proposal;
- bulk approve;
- deletes;
- photo attachments from `api.attachments`, which stay as they are;
- an AI producer;
- detecting duplicate new objects across accounts, such as two users adding the same route (see [Future: name matching](#future-name-matching)).

Add any of these only when they're actually needed.

## Future: name matching

Per-object identity prevents duplicates within one account. This phase is for duplicates across accounts, and for objects created outside submissions.

Phase after this plan: fuzzy name matching to catch new objects that duplicate an existing or pending record, such as "Me and My Shadow" vs. "Me & My Shadow" in the same sector. It would flag likely duplicates on the review page. It's deliberately not part of the conflict checks above, so don't add name comparisons there in the meantime.

## Steps

1. ✅ Audit log: `audit_log`, the `writeAudit` helper, and calls from the crag editor, the crag create and position actions, and `/api/v1/topos`.
2. ✅ The `submission` table, and deleting an account's rows with the account.
3. ✅ Intake and "my objects".
4. ✅ Approve and reject.
5. ✅ Review page.
6. ✅ Conflict checks against the audit log and other accounts' pending edits.
7. TopoBuilder (`../topobuilder`): send objects under local IDs, withdraw removed ones, and read "my objects". See [topobuilder-integration.md](topobuilder-integration.md).
8. ✅ Restrict `/api/v1/topos` writes to admin/super.
9. Issues tab.
10. ✅ Per-object proposals: one row per account and object (migration `0072`), replacing per-set submissions.

## Tests

Focused Vitest tests use `app/test/helpers.ts` and in-memory SQLite with the real migrations:

- intake: merging, published objects becoming edits or `unchanged`, published refs resolved, withdrawal, rejected objects proposed again, every validation rule, and stored file URLs;
- approval: parents first, with refs and annotation route links resolved; an edit changes only its own fields; a failure leaves earlier objects published and approving again continues;
- rejection marks every object in the item and writes rejected audit rows;
- conflicts: field conflicts from applied audit rows after the base time (not rejected rows, or rows within the slack), overlaps with other accounts' edits, and the record-changed warning;
- the review page's loader, actions, and UI.

The e2e suite (`e2e/submissions.spec.ts`, `e2e/app-workflows.spec.ts`) plays the TopoBuilder app against the real API: a member's new crag through approval, competing edits from two accounts, and an anonymous contributor's topo with images and annotations.
