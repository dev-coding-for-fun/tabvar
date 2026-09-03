---
name: d1-migration
description: >-
  Use this skill when creating, modifying, or applying Cloudflare D1 database migrations,
  writing SQLite schema changes, or regenerating Kysely TypeScript types in this repository.
---

# Cloudflare D1 Database Migrations

This runbook guides agents through creating, writing, applying, and verifying migrations for Cloudflare D1 (serverless SQLite) in this repository.

---

## 1. Create a New Migration File

Always use Wrangler to generate the sequentially numbered migration file:

```bash
npx wrangler d1 migrations create DB <migration_description>
```

- `DB` is the binding name configured in [wrangler.toml](file:///x:/Documents/GitHub/demofinder/wrangler.toml).
- This command automatically computes the next sequence number (e.g. `0060_<migration_description>.sql`) and places it in [migrations/](file:///x:/Documents/GitHub/demofinder/migrations).

---

## 2. Write SQLite-Compatible SQL

D1 is powered by SQLite 3. Ensure your migration adheres to SQLite dialect rules:

- **Data Types**: `INTEGER`, `TEXT`, `REAL`, `BLOB`. (Booleans are `INTEGER` 0 or 1).
- **Timestamps**:
  ```sql
  created_at DATETIME DEFAULT (DATETIME('now')),
  updated_at DATETIME DEFAULT (DATETIME('now'))
  ```
- **Updating `updated_at`**: SQLite does not have `ON UPDATE CURRENT_TIMESTAMP`. Use a trigger if automatic timestamp updating is required:
  ```sql
  CREATE TRIGGER IF NOT EXISTS trigger_my_table_updated_at
  AFTER UPDATE ON my_table
  FOR EACH ROW
  BEGIN
    UPDATE my_table SET updated_at = DATETIME('now') WHERE id = OLD.id;
  END;
  ```
- **Foreign Keys**: Enabled by default; specify `REFERENCES parent_table(id) ON DELETE CASCADE` if applicable.
- **Reference Existing Migrations**: Check [migrations/0058_add_issue_sync.sql](file:///x:/Documents/GitHub/demofinder/migrations/0058_add_issue_sync.sql) and [migrations/0059_add_attachment_parent_updated_at.sql](file:///x:/Documents/GitHub/demofinder/migrations/0059_add_attachment_parent_updated_at.sql) for established table and trigger patterns.

---

## 3. Apply the Migration Locally

Apply your migration to the local Miniflare SQLite database:

```bash
npx wrangler d1 migrations apply DB --local
```

Verify that all migrations are applied:

```bash
npx wrangler d1 migrations list DB --local
```

---

## 4. Regenerate TypeScript Definitions (Codegen)

Once the migration is applied locally, refresh the Kysely database schema definitions and Cloudflare worker types:

```bash
npm run typegen
```

This runs:
1. `wrangler types` (updates worker bindings).
2. `kysely-codegen` (inspects the local SQLite file referenced by `DATABASE_URL` in [.env](file:///x:/Documents/GitHub/demofinder/.env) and regenerates [app/lib/db.d.ts](file:///x:/Documents/GitHub/demofinder/app/lib/db.d.ts)).

Verify that [app/lib/db.d.ts](file:///x:/Documents/GitHub/demofinder/app/lib/db.d.ts) reflects your new table or columns.

---

## 5. Verify & Test

- **Ad-hoc Local Query**:
  ```bash
  npx wrangler d1 execute DB --local --command "SELECT * FROM my_new_table LIMIT 5;"
  ```
- **Run Typecheck**:
  ```bash
  npm run typecheck
  ```
- **Run Test Suite**:
  ```bash
  npm test
  ```
