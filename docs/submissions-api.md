# TABVAR Submissions API

API for proposing new and edited route data (crags, sectors, routes, and topos) from an external client such as TopoBuilder. Proposals wait for review until an admin approves or rejects them on `/admin/submissions`. Nothing is published until then.

Issue reports don't use this API; see [issue-sync-api.md](issue-sync-api.md). For how the TopoBuilder app fits this together with the sync APIs, see [topobuilder-integration.md](topobuilder-integration.md).

## The model

Submissions are **per object**. TABVAR keeps one record per account and object: the account's latest proposal for it, and, once it's published, the link between the app's own ID for the object (its `ref`) and the TABVAR record.

- **Repeating is safe.** Send the same object as often as you like, alone or with others, in any grouping and any order. It's still one proposal. Retries after a lost response, overlapping exports (a crag, then its sectors), and resubmits all just work.
- **New versions merge.** A resubmitted object is merged into its pending proposal field by field, with the newest value winning.
- **Published objects aren't recreated.** Proposing an object that's already published makes it an edit of that record. An edit that changes nothing is dropped.

## Authentication

Every request needs a bearer token from the TopoBuilder connect flow ([api-auth-and-onboarding.md](api-auth-and-onboarding.md)):

```http
Authorization: Bearer <token>
```

Any signed-in account can submit, including `anonymous` ones. Each caller only ever sees their own objects, whatever their role.

Timestamps use the SQLite UTC format `YYYY-MM-DD HH:MM:SS`.

---

## 1. Propose objects

```http
POST /api/topobuilder/submissions
```

Send JSON, or `multipart/form-data` with the JSON in a `submission` field when it includes images.

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
      "routes": [{ "routeId": 456, "label": "1" }, { "routeId": "local-route-88", "label": "2" }]
    } },
    { "entity": "route",  "ref": "local-route-90", "withdraw": true }
  ]
}
```

Each object names **either**:
- **`ref`:** your own stable ID for an object you're proposing. It must be unique within your account, and it's the object's identity from then on.
- **`id`:** an existing TABVAR record you're proposing an edit to.

Other fields on an object:
- **`fields`:** only the fields you're setting. Omitted fields keep the value from your pending proposal (or the record's current value), and `null` clears a field.
- **`baseUpdatedAt`** *(optional, edits)*: the record's `updatedAt` when the user last saw it. It helps the reviewer spot conflicts.
- **`withdraw: true`:** takes the object out of review. A new object's proposal is removed; an object you've already published stays published. You can't withdraw a parent while a pending child still points at it, so withdraw the children too.

References inside `fields` work the same way: `cragId`, `sectorId`, a topo's `routes[].routeId`, and annotation items' `routeId`. Each is either an existing record's numeric `id`, or the `ref` of one of your objects, pending or published. A ref to an object you've published is stored as its record ID.

Files are multipart parts referenced as `file:<part name>`. They must be JPEG, PNG, GIF, or WebP.

TABVAR measures a topo's background when it arrives and adds its size to the proposal as `imageWidth` and `imageHeight`. Annotations are positioned relative to that image. Don't send these two fields; they're set from the file.

### Editable fields

| Entity | Fields | Required for a new object |
| :--- | :--- | :--- |
| `crag` | `name`, `notes`, `latitude`, `longitude` | `name` |
| `sector` | `name`, `cragId`, `notes`, `latitude`, `longitude`, `sortOrder` | `name`, `cragId` |
| `route` | `name`, `altNames`, `sectorId`, `gradeYds`, `climbStyle`, `boltCount`, `pitchCount`, `routeLength`, `firstAscentBy`, `firstAscentDate`, `routeBuiltDate`, `year`, `status`, `notes`, `sortOrder`, `latitude`, `longitude` | `name`, `sectorId` |
| `topo` | `uuid` (new topos only), `name`, `description`, `cragId`, `sectorId`, `latitude`, `longitude`, `status` (`Active`/`Deleted`), `annotations`, `background`, `raster`, `routes` | `name`, `background`, `raster` |

There are no deletes; retire a route or topo by setting its `status`.

Limits: 500 objects per request, 200 routes per topo.

### Response `200`

The state of each object you sent, in order:

```json
{
  "objects": [
    { "entity": "crag",  "ref": "local-crag-17",  "id": null, "state": "pending" },
    { "entity": "route", "ref": null,             "id": 456,  "state": "pending" },
    { "entity": "route", "ref": "local-route-90", "id": null, "state": "withdrawn" }
  ]
}
```

| `state` | Meaning |
| :--- | :--- |
| `pending` | In review |
| `unchanged` | Matches the published record, so nothing was queued |
| `withdrawn` | Nothing of this object is in review |

### Errors

- **`400 invalid_submission`:** `message` lists the problems (up to 10), each naming the object and field, for example `objects[2].fields.sectorId refers to "s9", which isn't a sector you've proposed`. Nothing was stored.
- **`500 server_error`:** nothing was stored; retrying is safe.

---

## 2. List my objects

```http
GET /api/topobuilder/submissions
GET /api/topobuilder/submissions?since=<serverTime>
```

Returns the caller's objects, all of them, or those that changed since `since`. Pass back the `serverTime` from the previous call. The filter is inclusive, so upsert by `ref` (or by `entity` + `id` for edits of other records).

```json
{
  "objects": [
    {
      "entity": "route",
      "ref": "local-route-88",
      "id": 3301,
      "state": "published",
      "fields": { "name": "New Line", "sectorId": 210, "gradeYds": "5.11a" },
      "error": null,
      "receivedAt": "2026-10-16 12:00:00",
      "decidedAt": "2026-10-16 15:30:00"
    }
  ],
  "serverTime": "2026-10-16 15:30:00"
}
```

- `state` is `pending` (in review), `published` or `rejected`.
- `id` is the TABVAR record once there is one. For a new object, it appears when the object is approved.
- `fields` is the latest proposal, including the measured `imageWidth` and `imageHeight` of a topo's background.
- `error` on a pending object means approving it failed; it stays in review.
- Rejection doesn't give a reason. A rejected object can be proposed again, which starts a fresh proposal.

---

## How review works

The reviewer sees each account's pending objects grouped into **items**: objects linked by refs, such as a new crag with its new sectors, routes, and topos, plus any unrelated edit on its own. An item is approved or rejected as a whole, parents first. If approval fails partway, the objects before the failure are published and the rest stay pending until the item is approved again.
