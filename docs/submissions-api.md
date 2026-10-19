# TABVAR Submissions API

API for proposing new and edited route data (crags, sectors, routes, and topos) from an external client such as TopoBuilder. Proposals wait in a review queue until an admin approves or rejects them on `/admin/submissions`. Nothing is published until then.

Issue reports don't use this API; see [issue-sync-api.md](issue-sync-api.md). For how the TopoBuilder app fits this together with the sync APIs, see [topobuilder-integration.md](topobuilder-integration.md).

## Authentication

Every request needs a bearer token from the TopoBuilder connect flow ([api-auth-and-onboarding.md](api-auth-and-onboarding.md)):

```http
Authorization: Bearer <token>
```

Any signed-in account can submit, including `anonymous` ones. Each caller only ever sees their own submissions, whatever their role.

Timestamps use the SQLite UTC format `YYYY-MM-DD HH:MM:SS`.

---

## 1. Submit changes

```http
POST /api/topobuilder/submissions
POST /api/topobuilder/submissions?replace=<submission id>
```

Send the submission as a JSON body, or as `multipart/form-data` with the JSON in a `submission` field when it includes images.

**Resubmitting.** With `?replace=<id>`, the caller's pending submission with that ID is overwritten with the new changes and files. It keeps its ID, its time becomes now, and the reviewer sees only the latest version. If there's no such pending submission, because it was already decided or belongs to someone else, a new submission is created instead. Send the complete set of changes each time; nothing is merged with the previous version.

```json
{
  "changes": [
    { "ref": "c1", "entity": "crag", "op": "create", "fields": { "name": "New Crag" } },
    { "ref": "s1", "entity": "sector", "op": "create", "fields": { "name": "Main Wall", "cragId": "c1" } },
    { "ref": "r1", "entity": "route", "op": "create", "fields": { "name": "New Line", "sectorId": "s1", "gradeYds": "5.11a" } },
    { "entity": "route", "op": "update", "id": 456, "baseUpdatedAt": "2026-06-09 10:00:00", "fields": { "boltCount": 7 } },
    { "ref": "t1", "entity": "topo", "op": "create", "fields": {
      "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "name": "Main Wall Left", "sectorId": "s1",
      "background": "file:bg", "raster": "file:raster", "annotations": { "version": 1, "items": [] },
      "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "r1", "label": "2" }]
    } }
  ]
}
```

- **Changes** are applied in order. `op` is `create` or `update`; there are no deletes. Retire a route or topo by setting its `status`.
- **`ref`** names a create so later changes can point at it. Use the client's own local ID if that's convenient; the response to a status request maps each `ref` to its new TABVAR ID.
- **Parent IDs** (`cragId`, `sectorId`, and `routeId` in a topo's `routes`) are an existing numeric ID or the `ref` of an earlier create.
- **Annotations** are stored as given, except for `routeId` on an annotation item, such as a line drawn for a route. It follows the same rule: an existing route's numeric ID, or the `ref` of a route created earlier in the submission. Approval replaces refs with the new route IDs, so published annotations only contain TABVAR route IDs. An item without a route omits `routeId` or sets it to `null`.
- **Updates** need the target's `id` and carry only the fields being changed. `null` clears a field. `baseUpdatedAt`, the record's `updatedAt` when the user last saw it, is optional; it helps the reviewer spot conflicts.
- **Files** are multipart parts referenced as `file:<part name>`. They must be images.
- **Editable fields** use the sync API's names:

| Entity | Fields | Required to create |
| :--- | :--- | :--- |
| `crag` | `name`, `notes`, `latitude`, `longitude` | `name` |
| `sector` | `name`, `cragId`, `notes`, `latitude`, `longitude`, `sortOrder` | `name`, `cragId` |
| `route` | `name`, `altNames`, `sectorId`, `gradeYds`, `climbStyle`, `boltCount`, `pitchCount`, `routeLength`, `firstAscentBy`, `firstAscentDate`, `routeBuiltDate`, `year`, `status`, `notes`, `sortOrder`, `latitude`, `longitude` | `name`, `sectorId` |
| `topo` | `uuid` (create only), `name`, `description`, `cragId`, `sectorId`, `latitude`, `longitude`, `status`, `annotations`, `background`, `raster`, `routes` | `name`, `background`, `raster` |

**Response `201`** (new submission) **/ `200`** (replaced)

```json
{ "id": "6f1c…", "status": "pending", "replaced": false }
```

**Errors:**
- `400 invalid_submission`: `message` lists what's wrong (up to 10 problems).
- `409 conflict`: the submission named by `replace` can't be replaced, because an approval failed partway and some of its records may already be published. Wait for the review to finish.
- `500 server_error`: the submission couldn't be stored; retrying is safe.

A failed or invalid request leaves the earlier version of a replaced submission unchanged.

---

## 2. List my submissions

```http
GET /api/topobuilder/submissions
GET /api/topobuilder/submissions?since=<serverTime>
```

Returns the caller's own submissions:

- **Every queued submission**, with its changes, on every call. Use these to mark the affected crags, sectors, routes, and topos as "in review".
- **Decided submissions**: all of them on a first call, then only those decided since `since`. Pass back the `serverTime` from the previous call. The filter is inclusive, so dedupe by `id`.

**Response `200`**

```json
{
  "submissions": [
    {
      "id": "6f1c…",
      "submitterUid": "user-uid",
      "status": "pending",
      "createdAt": "2026-10-16 12:00:00",
      "error": null,
      "changes": [{ "ref": "r1", "entity": "route", "op": "create", "fields": { "name": "New Line", "sectorId": 12 } }]
    },
    {
      "id": "a2b9…",
      "submitterUid": "user-uid",
      "status": "approved",
      "decidedAt": "2026-10-15 09:30:00",
      "ids": { "c1": 41, "s1": 210, "r1": 3301 }
    },
    { "id": "d07e…", "submitterUid": "user-uid", "status": "rejected", "decidedAt": "2026-10-14 08:00:00", "ids": {} }
  ],
  "serverTime": "2026-10-15 09:30:00"
}
```

- `error` on a pending submission means an approval attempt failed and the submission is still queued. Changes made before the failure may already be published; their records show up in the regular sync APIs.
- `ids` maps each `ref` to the record created for it. Link local records to these IDs so later submissions edit them instead of creating duplicates.
- A rejected submission's records were never created; clear its "in review" markers. No reason is given.

---

## 3. Get one submission

```http
GET /api/topobuilder/submissions?id=<submission id>
```

**Response `200`**: `{ "id", "status", "error"? , "ids"? }`, the same status fields as in the list. Returns `404 not_found` if the caller has no submission with that ID.

---

## Typical client flow

1. Submit, and keep the returned `id` with the local records it covers.
2. Poll `GET /api/topobuilder/submissions?since=<serverTime>` alongside the other sync pulls.
3. While a submission is listed as `pending`, show its records as "in review".
4. When it's `approved`, adopt the IDs in `ids` and pick up the published records from the crag, sector, route, and topo sync APIs. When it's `rejected`, drop the markers.
