# TopoBuilder × TABVAR integration guide

For TopoBuilder developers and coding agents. It explains how TABVAR expects the app to read the catalog, propose route data, track what's in review, and report issues, and it points to the detailed API docs for each part.

## The model in one paragraph

TABVAR publishes crags, sectors, routes, and topos. The app **reads** them through the sync APIs. To **add or change** route data, the app sends a **submission**: a list of creates and edits. The submission waits in a review queue until a TABVAR admin approves or rejects it on the web, and nothing is public until it's approved. The app polls **"my submissions"** to show the user's proposals as "in review", and to learn the new IDs once they're published. **Issues** (bolt and hardware reports) are separate: they go through the issue sync API and their own moderation states.

## Detailed references

| Topic | Doc |
| :--- | :--- |
| Connecting an account, tokens, roles, errors | [api-auth-and-onboarding.md](api-auth-and-onboarding.md) |
| Proposing route data and tracking submissions | [submissions-api.md](submissions-api.md) |
| Pulling crags, sectors, and routes | [route-sync-api.md](route-sync-api.md) |
| Pulling topos (and admin-only direct publishing) | [topo-sync-api.md](topo-sync-api.md) |
| Reporting and syncing issues | [issue-sync-api.md](issue-sync-api.md) |
| How review works on the TABVAR side | [submissions-review-plan.md](submissions-review-plan.md) |

Working client code for every call below is in [`e2e/support/topobuilder.ts`](../e2e/support/topobuilder.ts), and [`e2e/app-workflows.spec.ts`](../e2e/app-workflows.spec.ts) runs these workflows end to end. Read them when the docs leave a question open.

---

## 1. Connect an account

1. Open `/connect/topobuilder?return_to=<allowlisted callback>` in a browser. The user signs in to TABVAR, and TABVAR redirects to the callback with `?ticket=…`.
2. `POST /api/topobuilder/connect/complete` with `{ "ticket": "…" }` returns `{ token, user: { uid, displayName, email, role } }`.
3. Store the token securely and send `Authorization: Bearer <token>` on every call. `POST /api/topobuilder/disconnect` revokes it.

Allowlisted callbacks: the `topobuilder:` scheme in production; `http://localhost:8081` and `http://localhost:19006` in local development.

### What each role can do

| | `anonymous` | `member` | `admin`, `super` |
| :--- | :---: | :---: | :---: |
| Pull the catalog (crags, sectors, routes, topos) | ✅ | ✅ | ✅ |
| Submit route data and track their own submissions | ✅ | ✅ | ✅ |
| Publish or delete topos directly (`/api/v1/topos`) | ❌ | ❌ | ✅ |
| Report issues | ✅, always `In Moderation` | ✅, any status (skips moderation) | ✅ |
| See issues in the pull | Public issues + their own in moderation | All issues | All issues |
| Edit issues, change status, archive | ❌ | ✅ | ✅ |

Every account, `anonymous` included, needs only a token to submit and track its own submissions. Use the `role` from the connect response to decide which controls to show.

---

## 2. Keep a local copy of the catalog

Pull each collection with a `since` cursor and keep the returned `serverTime` for the next pull:

```
GET /api/v1/crags?since=…
GET /api/v1/sectors?since=…
GET /api/v1/routes?since=…
GET /api/v1/topos?since=…
```

- Omit `since` for the first, full pull.
- `since` is **inclusive**, so upsert by `id`.
- Records are retired with `status` (`Deleted`, `Decommissioned`, …), not removed. A delta pull returns them so the app can update or drop them.
- Remember each record's `updatedAt`. It becomes `baseUpdatedAt` when the user edits that record (see §3).

---

## 3. Propose new and edited route data

`POST /api/topobuilder/submissions`, as JSON, or multipart with the JSON in a `submission` field when it includes images. The full contract is in [submissions-api.md](submissions-api.md); the essentials:

```json
{
  "changes": [
    { "ref": "local-crag-17",   "entity": "crag",   "op": "create", "fields": { "name": "New Crag" } },
    { "ref": "local-sector-4",  "entity": "sector", "op": "create", "fields": { "name": "Main Wall", "cragId": "local-crag-17" } },
    { "ref": "local-route-88",  "entity": "route",  "op": "create", "fields": { "name": "New Line", "sectorId": "local-sector-4", "gradeYds": "5.11a" } },
    { "entity": "route", "op": "update", "id": 456, "baseUpdatedAt": "2026-06-09 10:00:00", "fields": { "boltCount": 7 } },
    { "ref": "local-topo-3", "entity": "topo", "op": "create", "fields": {
        "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "name": "Main Wall Left", "sectorId": "local-sector-4",
        "background": "file:bg", "raster": "file:raster", "annotations": { "version": 1, "items": [] },
        "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "local-route-88", "label": "2" }] } }
  ]
}
```

How to build one from the app's local data:

- **One change per record.** List parents before children, because changes are applied in order.
- **New records** use `op: "create"` with a `ref`. Use the app's own local ID as the `ref`; it maps straight back to the new TABVAR ID after approval.
- **Existing TABVAR records** use their numeric `id`. Point at them by ID in parent fields and topo `routes`. **Never match records by name.** Two routes can share a name, and a renamed route keeps its ID.
- **Edits** carry **only the fields the user changed**. `null` clears a field. Send `baseUpdatedAt`, the record's `updatedAt` from the last pull, so the reviewer is warned if TABVAR changed the record since then.
- **Linking an unchanged catalog route** to a topo needs no change for that route; just use its ID in the topo's `routes`.
- **Topos** need a stable `uuid`, and on create the `background` (clean photo) and `raster` (rendered topo) images. Send each image as a multipart part and reference it as `file:<part name>`. JPEG, PNG, GIF, and WebP are accepted. `annotations` is `{ version, items }`.
- **Annotation route references:** set each item's `routeId` to the TABVAR ID for a catalog route, or to the route's `ref` (its local ID) for a route created in the same submission. Never use a local ID for a route that isn't in the submission; intake rejects it. On approval, TABVAR rewrites refs to the new route IDs, so annotations pulled from `/api/v1/topos` always hold TABVAR IDs. The app maps them back to its local routes through the IDs it adopted (§4). Other item fields are stored untouched.
- **No deletes.** Retire a route or topo by setting `status`. Topo `status` is `Active` or `Deleted`.
- **Limits:** 500 changes per submission, 200 routes per topo. Field names and editable fields are listed in [submissions-api.md](submissions-api.md).

**Responses**

- `201 { id, status: "pending" }`: store the submission `id` with the local records it covers (for topos, the existing `tabvarSubmissionId`).
- `400 invalid_submission`: the `message` lists up to 10 problems, each naming the change and field (for example `changes[2].fields.sectorId refers to sector 55, which doesn't exist`). Fix them and resubmit; nothing was stored.
- `500 server_error`: nothing was stored, so retry.

### Resubmitting before review

When the user changes something that's still in review, send the whole updated proposal with `?replace=<stored submission id>`. The pending submission is overwritten in place (`200`, same ID), so the review queue never fills up with stale copies.

- If that submission was already approved or rejected, a new one is created (`201`) with a new ID. Store the new ID.
- `409 conflict` means an approval failed partway, so some of its records may already be published. Don't resubmit; keep polling (§4) until it's decided.
- Each resubmission replaces the previous one entirely. Include every change, not just the latest edit.

### Lost responses

There's no idempotency key, so a request whose response never arrives may or may not have been stored. Don't retry blindly. Instead:

1. Poll "my submissions" (§4).
2. Look for a **pending** submission whose `changes` contain one of your refs. Refs are the app's local IDs, for example the local topo ID on its `topo` create.
3. If you find one, adopt its `id` as the stored submission ID; it was stored. If not, submit again, with `?replace=` if you have an older ID.

---

## 4. Show what's in review, and adopt the results

Poll `GET /api/topobuilder/submissions?since=<serverTime>` alongside the catalog pulls. It only ever returns the caller's own submissions, whatever their role.

- **`pending`** submissions are returned in full on every call, with their `changes`. Mark the records they touch (`entity`, plus `id` for edits or `ref` for creates) as "in review", and show proposed values where that helps. `error` set means an approval attempt failed and the submission is still queued. It needs no action from the app.
- **`approved`** submissions come with `ids`, mapping each `ref` to the new TABVAR ID. Re-key the local records to those IDs, clear their in-review markers, and pull the catalog to get the published versions. Later edits to those records then become `update`s instead of duplicate creates.
- **`rejected`** submissions: clear the markers and drop the local proposal, or keep it as a private draft. No reason is given; TABVAR rejects spam and junk silently.
- A decision is reported on the first poll after it happens. The cursor is inclusive, so dedupe by `id`. A call without `since` returns every past decision.

`GET /api/topobuilder/submissions?id=<id>` returns the status of a single submission.

A submission is approved or rejected as a whole. If the reviewer wanted part of it, they reject it and make the edit themselves; the change then shows up in the catalog pull.

---

## 5. Report issues

Issues use the issue sync API, not submissions ([issue-sync-api.md](issue-sync-api.md)).

- `POST /api/v1/issues/sync` with `op: "create"` and a client `externalId`. Retrying with the same `externalId` is safe. An `anonymous` user's report is always `In Moderation`; members' reports can be public straight away.
- `GET /api/v1/issues?since=…` pulls issues. `anonymous` callers get public issues plus their **own** reports while in moderation, so the app can show them as "in review". Members and admins get everything.
- On a delta pull, **`hiddenIssueIds`** lists issues that changed but are no longer visible to the caller, for example a report that was archived. Remove them locally.
- Updates send `baseUpdatedAt`. A newer server copy wins: the response is `409` with the current issue, which replaces the local one.
- Photos go to `POST /api/v1/issues/<id>/attachments`. Anonymous users can only add photos to their own reports.

---

## 6. Admin tools: publishing topos directly

Admins and supers can bypass review with `POST`/`DELETE /api/v1/topos` ([topo-sync-api.md](topo-sync-api.md)). Other roles get `403`, with a message pointing at the submissions API. Use it only for admin-facing features:

- An update keeps every field it leaves out. `routes` replaces all of the topo's links.
- Links must point to existing routes. New routes go through a submission.
- Images must be uploaded with the request, or already stored by TABVAR.

---

## Conventions

- **Timestamps** use UTC `YYYY-MM-DD HH:MM:SS`. Treat `serverTime` and `updatedAt` as opaque, and pass them back as given.
- **IDs** are numbers. **Refs** are the app's own strings, unique within one submission.
- **Field names** are camelCase and match the pull APIs (`gradeYds`, `sectorId`, …).
- **Errors** have the shape `{ "error": "<code>", "message": "…" }`; the codes are listed in [api-auth-and-onboarding.md](api-auth-and-onboarding.md#error-code-reference).

## Not available (yet)

- Deleting records through submissions. Use `status`.
- Partial approval, or the reviewer editing a proposal.
- A reason for a rejection.
- Detecting duplicates by name. Fuzzy name matching is planned for later, so don't rely on TABVAR to merge same-named records.
- An admin view of everyone's submissions in the app. Reviewing happens on the TABVAR website.

## Migrating from the old submission format

The earlier `/api/topobuilder/submissions` payload is rejected with `400`: the `kind` plus `crag`/`sector`/`topo` tree, routes referenced by name, a single image per topo. Moving to this flow means:

1. Build the `changes` list from §3: local IDs as refs, catalog records by numeric ID, edits as changed fields with `baseUpdatedAt`, topos with a `uuid` and both images.
2. Store the submission ID returned for each submission, resubmit edits with `?replace=`, and recover lost responses through "my submissions".
3. Poll "my submissions" (§4) to drive in-review markers, adopt the new IDs, and clear rejections.
4. Read published topos from `GET /api/v1/topos` instead of assuming a submission published them.
