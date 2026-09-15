# TABVAR Topo Sync API (v1)

API for synchronizing raw and raster topos between external clients (e.g., TopoBuilder) and Tabvar.

## Authentication & Authorization

All endpoints require a bearer token obtained via client authentication:

```
Authorization: Bearer <token>
```

- Writing (`POST`, `DELETE`) requires `member`, `admin`, or `super` role. Anonymous users will receive `403 Forbidden`.
- Errors use standard JSON error responses:
  ```json
  { "error": "forbidden", "message": "You must be logged in to modify topos." }
  ```

---

## Data Model & Identity

Tabvar standardizes on **numeric integer IDs** for all primary keys:
- Topos have an auto-incrementing integer `id: number`.
- For offline synchronization and idempotent creation from client devices, topos also feature a `uuid: string` (e.g. client-generated UUID v4).
- Topos are strictly route-scoped and are associated with routes via the `route_topo` junction table.

---

## 1. Save or Update Topo

```
POST /api/v1/topos
Content-Type: multipart/form-data
```

Creates a new topo or updates an existing topo if matching `id` or `uuid` is provided.

### Multipart Fields

| Field Name | Type | Description | Required? |
| :--- | :--- | :--- | :--- |
| `background` | File (`image/*`) | The clean high-resolution background photo without annotations | Yes (for new topos) |
| `raster` | File (`image/*`) | The rendered topo image with annotations, lines, and badges | Yes (for new topos) |
| `payload` | String (JSON) | JSON object containing metadata, annotations, and route links | Yes |

### `payload` JSON Schema

```json
{
  "id": 42,
  "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Cathedral Wall Center",
  "sectorId": 12,
  "latitude": 51.0543,
  "longitude": -115.3421,
  "status": "Active",
  "annotations": {
    "version": 1,
    "elements": [...]
  },
  "routes": [
    {
      "routeId": 101,
      "label": "1",
      "sortOrder": 1
    },
    {
      "name": "New Variation Line",
      "sectorId": 12,
      "gradeYds": "5.11b",
      "climbStyle": "Sport",
      "boltCount": 7,
      "pitchCount": 1,
      "routeLength": 25,
      "firstAscentBy": "Jane Climber",
      "firstAscentDate": "2026-06",
      "label": "2",
      "sortOrder": 2
    }
  ]
}
```

#### Routes Array: Existing vs. New Routes
The API supports submitting both **existing routes** and **new routes** in the `routes` array:

1. **Existing Route Reference**:
   - Provide `routeId` (numeric ID of existing Tabvar route).
   - `label` *(optional)*: Label or route number displayed on the topo badge (e.g. `"1"`, `"2A"`).
   - `sortOrder` *(optional)*: Integer order.

2. **New Route Creation**:
   - Omit `routeId` and provide `name` (string).
   - `sectorId` *(optional)*: Sector ID to place the route in. If omitted on the route item, falls back to the top-level `payload.sectorId`.
   - Optional route metadata: `gradeYds`, `climbStyle`, `boltCount`, `pitchCount`, `routeLength`, `firstAscentBy`, `firstAscentDate`, `routeBuiltDate`, `year`, `status`, `notes`.
   - The route will be created in the `route` table, indexed in search, and linked to the topo in `route_topo`.

### Response `201 Created` / `200 OK`

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
    "status": "Active",
    "annotations": { "version": 1, "elements": [...] },
    "createdAt": "2026-09-12 12:00:00",
    "updatedAt": "2026-09-12 12:00:00",
    "routes": [
      {
        "topoId": 42,
        "routeId": 101,
        "label": "1",
        "sortOrder": 1,
        "routeName": "Existing Route Name",
        "createdAt": "2026-09-12 12:00:00"
      },
      {
        "topoId": 42,
        "routeId": 102,
        "label": "2",
        "sortOrder": 2,
        "routeName": "New Variation Line",
        "createdAt": "2026-09-12 12:00:00"
      }
    ]
  }
}
```

---

## 2. Get Topo

```
GET /api/v1/topos?id=<numericId>
```
or
```
GET /api/v1/topos?uuid=<clientUuid>
```

Returns the specified topo including its resolved routes and annotation document.

---

## 3. Delete Topo (Soft Delete)

```
DELETE /api/v1/topos?id=<numericId>
```
or
```
DELETE /api/v1/topos?uuid=<clientUuid>
```

Sets `status = 'Deleted'` and updates `updated_at`.

### Response `200 OK`
```json
{
  "success": true,
  "deleted": true
}
```

---

## 4. UI Presentation on Routes

Topos linked to a route are presented on the route detail view (`RouteCard`) alongside photo attachments:
- The rasterized rendered topo (`rasterImageUrl`) is displayed at the top of the attachments list (`isTopo: true`).
- Unlike standard user photo attachments, topos cannot be deleted from the route card attachments list (the delete button is hidden for topo items).
