# TABVAR Topo Sync API (v1)

API for reading topos (annotated crag photos linked to routes), and for admins and supers to publish them directly.

Everyone else, TopoBuilder users included, proposes new or changed topos through the [Submissions API](submissions-api.md), where an admin reviews them before they're published.

## Authentication & Authorization

All endpoints require a bearer token obtained via client authentication:

```
Authorization: Bearer <token>
```

- **Reading** (`GET`) works with any token.
- **Writing** (`POST`, `DELETE`) requires the `admin` or `super` role. Other callers get `403 Forbidden`, pointing them to the Submissions API.
- Errors use standard JSON error responses:
  ```json
  { "error": "forbidden", "message": "Only admins and supers can change topos directly. Propose changes through /api/topobuilder/submissions." }
  ```

| Status | Error | When |
| :--- | :--- | :--- |
| 400 | `bad_request` | The payload is invalid, or refers to a crag, sector, or route that doesn't exist |
| 403 | `forbidden` | Writing without the `admin` or `super` role |
| 404 | `not_found` | The topo `id` doesn't exist |
| 500 | `server_error` | The topo couldn't be saved, e.g. a storage failure |

---

## Data Model & Identity

- Topos have an auto-incrementing integer `id`.
- Topos also have a `uuid`, so clients can create them offline and match them later.
- `status` is `Active` or `Deleted`. Deleting is a soft delete.
- Topos link to routes through the `route_topo` junction table, each link with an optional `label` (the number on the topo badge) and a `sortOrder`.

---

## 1. Save or Update Topo (admin, super)

```
POST /api/v1/topos
Content-Type: multipart/form-data   (or application/json without files)
```

Creates a topo, or updates one matched by `id` or `uuid`.

- **`id`** must belong to an existing topo; otherwise the response is `404`.
- **`uuid`** updates the topo with that UUID, or creates one if none exists.
- On an update, **omitted fields keep their current values**, and `null` clears a nullable field.

### Multipart Fields

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `background` | File (`image/*`) | The clean background photo without annotations. Required to create a topo unless `backgroundUrl` is given. |
| `raster` | File (`image/*`) | The rendered topo with lines and badges. Required to create a topo unless `rasterUrl` is given. |
| `payload` | String (JSON) | The topo fields below. |

Images must be JPEG, PNG, GIF, or WebP. TABVAR measures the uploaded background and stores its size as `imageWidth` and `imageHeight`, the space annotations are positioned in; clients don't send them. The size is the image as displayed, after any EXIF orientation: a quarter-turn orientation (5–8) swaps width and height.

### `payload` JSON

```json
{
  "id": 42,
  "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Cathedral Wall Center",
  "description": "Left half of the wall",
  "cragId": 1,
  "sectorId": 12,
  "latitude": 51.0543,
  "longitude": -115.3421,
  "status": "Active",
  "annotations": { "version": 1, "items": [] },
  "routes": [
    { "routeId": 101, "label": "1", "sortOrder": 1 },
    { "routeId": 102, "label": "2", "sortOrder": 2 }
  ]
}
```

- `name` is required to create a topo.
- `cragId` and `sectorId` must refer to existing records.
- `routes` replaces all of the topo's route links when present; omit it to leave the links alone. Each entry needs the `routeId` of an existing route, and a route can only be linked once. New routes can't be created here; propose them through the [Submissions API](submissions-api.md), or add them in the crag editor.
- `backgroundUrl` and `rasterUrl` may name images already stored by TABVAR instead of uploading files. Other hosts are rejected.
- Uploaded images are stored once by content. Replacing a topo's raster deletes the old one unless something else uses it; a replaced background is kept.
- `status` must be `Active` or `Deleted`.
- `annotations` is `{ version, items }`, stored as given. An item's `routeId` holds a TABVAR route ID: topos published from submissions have local refs replaced on approval, and direct saves should use TABVAR IDs too.

### Response `201 Created` (new topo) / `200 OK` (update)

```json
{
  "topo": {
    "id": 42,
    "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Cathedral Wall Center",
    "sectorId": 12,
    "latitude": 51.0543,
    "longitude": -115.3421,
    "backgroundImageUrl": "https://files.tabvar.org/topos/raw/abc123hash.jpg",
    "rasterImageUrl": "https://files.tabvar.org/topos/raster/def456hash.jpg",
    "imageWidth": 4032,
    "imageHeight": 3024,
    "status": "Active",
    "annotations": { "version": 1, "items": [] },
    "createdAt": "2026-09-12 12:00:00",
    "updatedAt": "2026-09-12 12:00:00",
    "routes": [
      { "topoId": 42, "routeId": 101, "label": "1", "sortOrder": 1, "routeName": "Existing Route Name", "createdAt": "2026-09-12 12:00:00" }
    ]
  }
}
```

Every write is recorded in the audit log with the caller as author.

---

## 2. Get Topos

```
GET /api/v1/topos?id=<numericId>
GET /api/v1/topos?uuid=<clientUuid>
```

Returns one topo with its routes and annotations, or `404`.

```
GET /api/v1/topos
GET /api/v1/topos?since=<serverTime>&sectorId=<id>&cragId=<id>
```

Lists topos as `{ topos, serverTime }`.

- **Without `since`:** active topos only.
- **With `since`:** every topo updated since then, deleted ones included, so clients can remove them. Pass the returned `serverTime` as `since` next time.
- `sectorId` and `cragId` narrow the list.

---

## 3. Delete Topo (admin, super)

```
DELETE /api/v1/topos?id=<numericId>
DELETE /api/v1/topos?uuid=<clientUuid>
```

Sets `status = 'Deleted'` and updates `updated_at`. Returns `404` if the topo doesn't exist.

### Response `200 OK`
```json
{ "success": true }
```

---

## 4. UI Presentation on Routes

Topos linked to a route are presented on the route detail view (`RouteCard`) alongside photo attachments:
- The rasterized rendered topo (`rasterImageUrl`) is displayed at the top of the attachments list (`isTopo: true`).
- Unlike standard user photo attachments, topos cannot be deleted from the route card attachments list (the delete button is hidden for topo items).
