# TABVAR Issue Sync API (v1)

Bidirectional issue sync for external clients (e.g. the TopoBuilder mobile app).
Clients can pull issues with a delta cursor and push offline creates, content
edits, and status changes back. Conflicts are resolved **server-wins**.

## Authentication

All endpoints require a bearer token (obtained via the client connect flow):

```
Authorization: Bearer <token>
```

The token is mapped to a user account; its **role** determines permissions:

- `anonymous` — may only create new issues (forced to `In Moderation`) and
  upload photos to issues they reported.
- `member` / `admin` / `super` — full create, edit, and status transitions.

Errors use a consistent shape plus an HTTP status:

```json
{ "error": "forbidden", "message": "Human-readable reason." }
```

| code                 | status |
| -------------------- | ------ |
| `invalid_token`      | 401    |
| `forbidden`          | 403    |
| `not_found`          | 404    |
| `bad_request`        | 400    |
| `conflict`           | 409    |
| `method_not_allowed` | 405    |

CORS preflight (`OPTIONS`) is supported on all endpoints.

Timestamps from the server use SQLite UTC format: `YYYY-MM-DD HH:MM:SS`.

---

## 1. Pull issues (delta sync)

```
GET /api/v1/issues?since=<cursor>
```

- `since` *(optional)* — a `serverTime` cursor from a previous pull. Omit for a
  full initial pull. The filter is **inclusive** (`updated_at >= since`), so
  dedupe/upsert by `id`.
- Soft-deleted issues are returned with `status: "Deleted"` so clients can
  remove them locally.

**Response `200`**

```json
{
  "issues": [
    {
      "id": 123,
      "routeId": 456,
      "cragId": 7,
      "issueType": "Bolts",
      "subIssueType": "Rusted",
      "status": "Reported",
      "lastStatus": null,
      "description": "Spinner on bolt 2",
      "boltsAffected": "2",
      "isFlagged": false,
      "flaggedMessage": null,
      "reportedBy": "Jane Doe",
      "reportedByUid": "user-uid",
      "createdAt": "2026-06-01 00:00:00",
      "updatedAt": "2026-06-09 10:00:00",
      "lastModified": "2026-06-09T10:00:00.000Z",
      "approvedAt": null,
      "archivedAt": null,
      "attachments": [
        { "id": 11, "url": "https://.../photo.jpg", "name": "photo.jpg", "type": "image/jpeg" }
      ]
    }
  ],
  "serverTime": "2026-06-09 11:00:00"
}
```

Store `serverTime` and pass it as `since` on the next pull.

---

## 2. Push a single issue change

```
POST /api/v1/issues/sync
Content-Type: application/json
```

**One issue per request.** Loop client-side for multiple changes.

**Body**

```json
{
  "op": "create | update | status",
  "externalId": "client-generated-uuid",
  "issueId": 123,
  "baseUpdatedAt": "2026-06-09 10:00:00",
  "fields": {
    "routeId": 456,
    "issueType": "Bolts",
    "subIssueType": "Rusted",
    "description": "…",
    "boltsAffected": "2",
    "status": "Reported",
    "lastStatus": null,
    "isFlagged": false,
    "flaggedMessage": null
  }
}
```

| field           | applies to        | notes                                                        |
| --------------- | ----------------- | ----------------------------------------------------------- |
| `op`            | all               | `create`, `update`, or `status`                             |
| `externalId`    | create            | your offline UUID; enables idempotent retries               |
| `issueId`       | update, status    | required                                                     |
| `baseUpdatedAt` | update, status    | required; the `updatedAt` you last saw (conflict basis)     |
| `fields.routeId`    | create        | required                                                     |
| `fields.issueType`  | create        | required                                                     |
| `fields.status`     | create, status | create: optional (defaults `In Moderation`); status: required |

Operations:

- **`create`** — new issue. Provide `externalId`; retries with the same
  `externalId` are idempotent and return the original `serverId`.
- **`update`** — edit content fields (`issueType`, `subIssueType`,
  `description`, `boltsAffected`, `isFlagged`, `flaggedMessage`).
- **`status`** — change status. A **delete** is `op: "status"` with
  `fields.status = "Deleted"`.

**Conflict handling (server wins):** for `update`/`status`, if the server's
`updated_at` is newer than your `baseUpdatedAt`, the change is rejected.

**Response `409`**

```json
{ "status": "conflict", "serverId": 123, "issue": { "...": "current server issue" } }
```

Re-pull, reconcile, and retry with the new `baseUpdatedAt`.

**Success `200` (update/status) or `201` (create)**

```json
{ "status": "applied", "serverId": 123, "issue": { "...": "updated server issue" } }
```

**Valid status values:** `In Moderation`, `Reported`, `Viewed`, `Completed`,
`Archived`, `Deleted`.

---

## 3. Upload attachments

```
POST /api/v1/issues/<issueId>/attachments
Content-Type: multipart/form-data
```

- Field name: `photos` (repeat for multiple). Up to **3 files**, **5 MB each**,
  image types only (`image/jpeg`, `image/png`, `image/gif`, `image/webp`).
- Use after the parent issue has a server `id` (upload queued offline photos
  once `create` returns its `serverId`).
- `anonymous` may upload only to issues they reported; `member`+ to any issue.

**Response `201`**

```json
{
  "attachments": [
    { "id": 5, "url": "https://.../photo.jpg", "name": "photo.jpg", "type": "image/jpeg" }
  ]
}
```

---

## Typical client flow

1. `GET /api/v1/issues` (no `since`) → seed local store, save `serverTime`.
2. On reconnect: for each local change, `POST /api/v1/issues/sync`. On `201`
   for creates, map your `externalId` → `serverId`, then upload any queued
   photos to `/api/v1/issues/<serverId>/attachments`.
3. Handle `409` by re-pulling and reconciling (server wins).
4. Periodically `GET /api/v1/issues?since=<serverTime>` and upsert/remove by
   `id`.
