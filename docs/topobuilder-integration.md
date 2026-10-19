# TopoBuilder × TABVAR integration guide

For TopoBuilder developers and coding agents. It explains how TABVAR expects the app to read the catalog, propose route data, track what's in review, and report issues, and it points to the detailed API docs for each part.

## The model in one paragraph

TABVAR publishes crags, sectors, routes, and topos. The app **reads** them through the sync APIs. To **add or change** route data, the app **proposes objects**: new objects under the app's own local IDs, and edits to existing records by their TABVAR IDs. TABVAR keeps one proposal per account and object, so sending an object again just updates its proposal. Proposals wait until a TABVAR admin approves or rejects them on the web, and nothing is public until it's approved. The app polls **"my objects"** to show what's in review, and to learn the TABVAR IDs of its objects once they're published. **Issues** (bolt and hardware reports) are separate: they go through the issue sync API and their own moderation states.

## Detailed references

| Topic | Doc |
| :--- | :--- |
| Connecting an account, tokens, roles, errors | [api-auth-and-onboarding.md](api-auth-and-onboarding.md) |
| Proposing route data and tracking it | [submissions-api.md](submissions-api.md) |
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
| Propose route data and track their own proposals | ✅ | ✅ | ✅ |
| Publish or delete topos directly (`/api/v1/topos`) | ❌ | ❌ | ✅ |
| Report issues | ✅, always `In Moderation` | ✅, any status (skips moderation) | ✅ |
| See issues in the pull | Public issues + their own in moderation | All issues | All issues |
| Edit issues, change status, archive | ❌ | ✅ | ✅ |

Every account, `anonymous` included, needs only a token to propose objects and track its own proposals. Use the `role` from the connect response to decide which controls to show.

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
  "objects": [
    { "entity": "crag",   "ref": "local-crag-17",  "fields": { "name": "New Crag" } },
    { "entity": "sector", "ref": "local-sector-4", "fields": { "name": "Main Wall", "cragId": "local-crag-17" } },
    { "entity": "route",  "ref": "local-route-88", "fields": { "name": "New Line", "sectorId": "local-sector-4", "gradeYds": "5.11a" } },
    { "entity": "route",  "id": 456, "baseUpdatedAt": "2026-06-09 10:00:00", "fields": { "boltCount": 7 } },
    { "entity": "topo",   "ref": "local-topo-3", "fields": {
        "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "name": "Main Wall Left", "sectorId": "local-sector-4",
        "background": "file:bg", "raster": "file:raster",
        "annotations": { "version": 1, "items": [{ "id": "line-1", "routeId": "local-route-88" }] },
        "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "local-route-88", "label": "2" }] } }
  ]
}
```

The app's rules:

1. **Send objects under their local IDs, with any parents that aren't published yet.** An object the app created is identified by its `ref`, which is the app's own local ID for it, forever. Its parents go in the same request unless they're already in review or published. Each object carries its own links (`cragId`, `sectorId`, topo `routes`, annotation `routeId`), as a TABVAR ID or a local ID. Order and grouping don't matter.
2. **Withdraw what the user removed.** `{ "entity": "route", "ref": "local-route-90", "withdraw": true }` takes a proposal out of review. Withdraw children along with their parent.
3. **Read "my objects" (§4)** to show what's in review and to learn TABVAR IDs.
4. **Resending is always safe.** Sending an object again, alone or within a larger export, updates its one proposal: the fields it sends replace the proposed values, and the rest are kept. After a lost response, or when unsure what TABVAR has, just send again.

How to fill in each object:

- **Records the app pulled from TABVAR** are edited by their numeric `id`, and linked by ID. **Never match records by name.** Two routes can share a name, and a renamed route keeps its ID.
- **Edits** carry **only the fields the user changed**. `null` clears a field. Send `baseUpdatedAt`, the record's `updatedAt` from the last pull, so the reviewer is warned if TABVAR changed the record since then.
- **The app's own objects after they're published** can still be sent by `ref`. TABVAR turns that into an edit of the published record, and drops it as `unchanged` if nothing differs. Switching to the TABVAR `id` once known is fine too.
- **Linking an unchanged catalog route** to a topo needs no object for that route; just use its ID in the topo's `routes`.
- **Topos** need a stable `uuid`, and when new, the `background` (clean photo) and `raster` (rendered topo) images. Send each image as a multipart part and reference it as `file:<part name>`. JPEG, PNG, GIF, and WebP are accepted.
- **Image size:** TABVAR measures the background itself and returns its size as `imageWidth`/`imageHeight`, so the normalized annotation points line up with what's displayed. Don't send the size.
- **Annotations** are `{ version, items }`.
- **Annotation route references:** set each item's `routeId` to the TABVAR ID for a catalog route, or to the route's local ID for one of the app's own routes. On approval, TABVAR rewrites local IDs to TABVAR IDs, so annotations pulled from `/api/v1/topos` always hold TABVAR IDs. The app maps them back through the IDs it adopted (§4). Other item fields are stored untouched.
- **No deletes.** Retire a route or topo by setting `status`. Topo `status` is `Active` or `Deleted`.
- **Limits:** 500 objects per request, 200 routes per topo. Field names and editable fields are listed in [submissions-api.md](submissions-api.md).

**Responses**

- `200 { objects: [{ entity, ref, id, state }] }`, one per object sent, in order. `state` is `pending` (in review), `unchanged` (it matches the published record, so nothing is in review), or `withdrawn`.
- `400 invalid_submission`: the `message` lists up to 10 problems, each naming the object and field (for example `objects[2].fields.sectorId refers to "s9", which isn't a sector you've proposed`). Nothing was stored; fix them and send again.
- `500 server_error`: nothing was stored, so retry.

---

## 4. Show what's in review, and adopt the results

Poll `GET /api/topobuilder/submissions?since=<serverTime>` alongside the catalog pulls. It returns the caller's own objects that changed since the cursor, whatever their role. Upsert them by `ref` (or by `entity` + `id` for edits of records the app didn't create). The cursor is inclusive.

- **`pending`:** mark the object "in review", and show the proposed `fields` where that helps. `error` set means an approval attempt failed and it's still queued. It needs no action from the app.
- **`published`:** `id` is the TABVAR record. Re-key the local object to it, clear the in-review marker, and pull the catalog to get the published version.
- **`rejected`:** clear the marker and drop the proposal, or keep it as a private draft. No reason is given; TABVAR rejects spam and junk silently. Sending the object again starts a fresh proposal.

A call without `since` returns every object the account has proposed, which is how the app rebuilds its state after a reinstall.

The reviewer approves or rejects an account's linked objects together: a new crag with its new sectors, routes and topos is one review item. If the reviewer wanted only part of it, they reject it and make the edit themselves; the change then shows up in the catalog pull.

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
- Links must point to existing routes. New routes go through a proposal.
- Images must be uploaded with the request, or already stored by TABVAR.

---

## Conventions

- **Timestamps** use UTC `YYYY-MM-DD HH:MM:SS`. Treat `serverTime` and `updatedAt` as opaque, and pass them back as given.
- **IDs** are numbers. **Refs** are the app's own local IDs, as strings, and must be unique within the account (across entities too).
- **Field names** are camelCase and match the pull APIs (`gradeYds`, `sectorId`, …).
- **Errors** have the shape `{ "error": "<code>", "message": "…" }`; the codes are listed in [api-auth-and-onboarding.md](api-auth-and-onboarding.md#error-code-reference).

## Not available (yet)

- Deleting records through proposals. Use `status`.
- Partial approval of a review item, or the reviewer editing a proposal.
- A reason for a rejection.
- Detecting duplicates by name. Fuzzy name matching is planned for later, so don't rely on TABVAR to merge same-named records.
- An admin view of everyone's proposals in the app. Reviewing happens on the TABVAR website.

## Migrating from the old submission format

The earlier `/api/topobuilder/submissions` payloads are rejected with `400`: the `kind` plus `crag`/`sector`/`topo` tree, and the `changes` list with `op`. Moving to this flow means:

1. Build the `objects` list from §3: local IDs as refs, with unpublished parents included; catalog records by numeric ID; edits as changed fields with `baseUpdatedAt`; topos with a `uuid` and both images.
2. Drop any stored submission IDs. Objects are tracked by their local IDs, and resending replaces nothing but the fields it sends.
3. Poll "my objects" (§4) to drive in-review markers, adopt the TABVAR IDs, and clear rejections.
4. Read published topos from `GET /api/v1/topos` instead of assuming a proposal published them.
