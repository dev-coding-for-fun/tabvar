---
name: issue-sync-api
description: >-
  Use this skill when developing or debugging the v1 mobile sync API, TopoBuilder sync,
  issue attachments, or offline delta sync endpoints.
---

# Issue Sync API (v1) Guide

This runbook provides reference knowledge and test patterns for developing against the bidirectional mobile issue sync API (used by external clients such as the **TopoBuilder** mobile app). The complete specification is maintained in [docs/issue-sync-api.md](file:///x:/Documents/GitHub/demofinder/docs/issue-sync-api.md).

---

## 1. Authentication & Role Permissions

All sync endpoints require a Bearer token:
```
Authorization: Bearer <token>
```
Validated via `requireApiTokenUser(request, context)` in [app/lib/apiAuth.server.ts](file:///x:/Documents/GitHub/demofinder/app/lib/apiAuth.server.ts).

### Roles & Access Matrix:
| Role | Issue Pull | Create Issues | Update Issues / Status | Upload Attachments |
| :--- | :---: | :---: | :---: | :---: |
| `anonymous` | ✅ | ✅ (forced to `In Moderation`) | ❌ Forbidden | ✅ (only to reported issues) |
| `member` / `admin` / `super` | ✅ | ✅ | ✅ Full transitions | ✅ |

---

## 2. Core Endpoints

### 1. Pull Issues (Delta Sync Cursor)
`GET /api/v1/issues?since=<serverTime>`
- Implemented in [app/routes/api.v1.issues.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.ts).
- `since`: SQLite UTC format timestamp (`YYYY-MM-DD HH:MM:SS`).
- Inclusive filter (`updated_at >= since`).
- Soft-deleted issues return with `status: "Deleted"`.
- Response includes `serverTime` for the client to store as its next cursor.

### 2. Push Issue Mutation
`POST /api/v1/issues/sync`
- Implemented in [app/routes/api.v1.issues.sync.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.sync.ts).
- Client submits a mutation operation:
  - `op: "create"`
  - `op: "update"`
- **Conflict Resolution (Server-Wins)**:
  - For `update` operations, the client sends `baseUpdatedAt`.
  - If `server.updated_at > client.baseUpdatedAt`, the server rejects that specific mutation with status `409 Conflict` (`status: "conflict"`).
- Soft deletes are applied by submitting `op: "update"` with `fields: { status: "Deleted" }`.

### 3. Attachment Uploads
`POST /api/v1/issues/:id/attachments`
- Implemented in [app/routes/api.v1.issues.$id.attachments.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.$id.attachments.ts).
- Handles multipart uploads, writes photos to R2 (`TABVAR_ISSUES_UPLOADS`), and records attachment rows.
- Updates the parent issue's `updated_at` so delta sync picks up the change.

---

## 3. Testing Reference

When modifying sync endpoints, reference existing tests:
- [app/routes/api.v1.issues.sync.test.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.sync.test.ts)
- [app/routes/api.v1.issues.test.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.test.ts)
- [app/routes/api.v1.issues.$id.attachments.test.ts](file:///x:/Documents/GitHub/demofinder/app/routes/api.v1.issues.$id.attachments.test.ts)
