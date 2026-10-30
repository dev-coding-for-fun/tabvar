#!/usr/bin/env node

/**
 * Fast cleanup utility for E2E test data generated in local Miniflare D1.
 *
 * Removes ephemeral crags, sectors, routes, topos, submissions, issues,
 * audit records, and connect tokens prefixed with `E2E ` or authored by
 * personas ending in `@e2e.test`.
 *
 * Usage:
 *   node scripts/clean-e2e-data.mjs            # clean generated test data
 *   node scripts/clean-e2e-data.mjs --dry-run  # preview records to delete
 *   node scripts/clean-e2e-data.mjs --users    # also remove persona accounts & .auth cache
 *   node scripts/clean-e2e-data.mjs --quiet    # minimal logging
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Locates the local Miniflare D1 SQLite database file.
 * @returns {string | null}
 */
export function findLocalD1Database() {
  // 1. Check environment variable / .env
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    const cleaned = envUrl.replace(/^file:/, "").trim();
    const resolved = path.resolve(cleaned);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // 2. Read .env file directly if available
  const envFile = path.resolve(".env");
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      const cleaned = match[1].trim().replace(/^['"]|['"]$/g, "").replace(/^file:/, "");
      const resolved = path.resolve(cleaned);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  // 3. Search .wrangler state directory
  const wranglerDir = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  if (fs.existsSync(wranglerDir)) {
    const files = fs.readdirSync(wranglerDir);
    const sqliteFiles = files.filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
    if (sqliteFiles.length > 0) {
      return path.join(wranglerDir, sqliteFiles[0]);
    }
  }

  return null;
}

/**
 * @param {object} [options]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.includeUsers]
 * @param {boolean} [options.quiet]
 * @returns {{ deleted: Record<string, number>, totalDeleted: number, durationMs: number }}
 */
export function cleanE2EData(options = {}) {
  const start = performance.now();
  const dbPath = options.dbPath || findLocalD1Database();

  if (!dbPath) {
    if (!options.quiet) {
      console.warn("[Clean E2E] No local D1 database file found. Nothing to clean.");
    }
    return { deleted: {}, totalDeleted: 0, durationMs: performance.now() - start };
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");

  const deleteQueries = [
    {
      table: "issue_attachment",
      query: `
        DELETE FROM issue_attachment WHERE issue_id IN (
          SELECT id FROM issue WHERE description LIKE 'Spinner on bolt 2%'
            OR external_id LIKE '%-%'
            OR reported_by_uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
        )
      `,
    },
    {
      table: "issue_audit_log",
      query: `
        DELETE FROM issue_audit_log WHERE issue_id IN (
          SELECT id FROM issue WHERE description LIKE 'Spinner on bolt 2%'
            OR external_id LIKE '%-%'
            OR reported_by_uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
        ) OR uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
      `,
    },
    {
      table: "issue",
      query: `
        DELETE FROM issue WHERE description LIKE 'Spinner on bolt 2%'
          OR external_id LIKE '%-%'
          OR reported_by_uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
          OR route_id IN (SELECT id FROM route WHERE name LIKE 'E2E %')
      `,
    },
    {
      table: "route_topo",
      query: `
        DELETE FROM route_topo WHERE topo_id IN (
          SELECT id FROM topo WHERE name LIKE 'E2E %' OR uuid LIKE '%-%'
        ) OR route_id IN (
          SELECT id FROM route WHERE name LIKE 'E2E %'
        )
      `,
    },
    {
      table: "topo",
      query: `
        DELETE FROM topo WHERE name LIKE 'E2E %'
          OR description = 'Left side'
          OR sector_id IN (SELECT id FROM sector WHERE name LIKE 'E2E %' OR crag_id IN (SELECT id FROM crag WHERE name LIKE 'E2E %'))
      `,
    },
    {
      table: "route",
      query: `
        DELETE FROM route WHERE name LIKE 'E2E %'
          OR sector_id IN (SELECT id FROM sector WHERE name LIKE 'E2E %' OR crag_id IN (SELECT id FROM crag WHERE name LIKE 'E2E %'))
      `,
    },
    {
      table: "sector",
      query: `
        DELETE FROM sector WHERE name LIKE 'E2E %'
          OR crag_id IN (SELECT id FROM crag WHERE name LIKE 'E2E %')
      `,
    },
    {
      table: "crag",
      query: `DELETE FROM crag WHERE name LIKE 'E2E %'`,
    },
    {
      table: "submission",
      query: `
        DELETE FROM submission WHERE uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
          OR fields LIKE '%E2E %'
          OR ref LIKE 'crag-%' OR ref LIKE 'sector-%' OR ref LIKE 'route-%' OR ref LIKE 'topo-%'
      `,
    },
    {
      table: "audit_log",
      query: `
        DELETE FROM audit_log WHERE author_uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')
          OR changes LIKE '%E2E %'
          OR author_name LIKE 'E2E %'
          OR reviewer_name LIKE 'E2E %'
      `,
    },
    {
      table: "vote",
      query: `DELETE FROM vote WHERE uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')`,
    },
    {
      table: "api_token",
      query: `DELETE FROM api_token WHERE uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')`,
    },
    {
      table: "topobuilder_connect_ticket",
      query: `DELETE FROM topobuilder_connect_ticket WHERE uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')`,
    },
  ];

  if (options.includeUsers) {
    deleteQueries.push(
      {
        table: "user_tag_assignment",
        query: `DELETE FROM user_tag_assignment WHERE uid IN (SELECT uid FROM user WHERE email LIKE '%@e2e.test')`,
      },
      {
        table: "user",
        query: `DELETE FROM user WHERE email LIKE '%@e2e.test'`,
      },
    );
  }

  /** @type {Record<string, number>} */
  const deletedCounts = {};
  let totalDeleted = 0;

  if (options.dryRun) {
    for (const { table, query } of deleteQueries) {
      const selectQuery = query.replace(/^\s*DELETE\s+FROM/, "SELECT count(*) as count FROM");
      try {
        const row = db.prepare(selectQuery).get();
        const count = row ? row.count : 0;
        deletedCounts[table] = count;
        totalDeleted += count;
      } catch (err) {
        deletedCounts[table] = 0;
      }
    }
    db.close();

    if (!options.quiet) {
      console.log(`[Clean E2E: Dry Run] Target: ${path.basename(dbPath)}`);
      for (const [tbl, count] of Object.entries(deletedCounts)) {
        if (count > 0) console.log(`  - ${tbl}: ${count} rows to delete`);
      }
      console.log(`Total: ${totalDeleted} rows would be deleted.`);
    }

    return { deleted: deletedCounts, totalDeleted, durationMs: performance.now() - start };
  }

  const transaction = db.transaction(() => {
    for (const { table, query } of deleteQueries) {
      try {
        const info = db.prepare(query).run();
        deletedCounts[table] = info.changes;
        totalDeleted += info.changes;
      } catch (err) {
        deletedCounts[table] = 0;
      }
    }
  });

  transaction();
  db.close();

  // If removing users, also clean cached storage states in e2e/.auth/
  if (options.includeUsers) {
    const authDir = path.resolve("e2e/.auth");
    if (fs.existsSync(authDir)) {
      for (const file of fs.readdirSync(authDir)) {
        if (file.endsWith(".json")) {
          try {
            fs.unlinkSync(path.join(authDir, file));
          } catch {}
        }
      }
    }
  }

  const durationMs = performance.now() - start;

  if (!options.quiet) {
    console.log(`[Clean E2E] Cleaned ${totalDeleted} records from ${path.basename(dbPath)} in ${durationMs.toFixed(1)}ms`);
    for (const [tbl, count] of Object.entries(deletedCounts)) {
      if (count > 0) console.log(`  - ${tbl}: ${count} deleted`);
    }
  }

  return { deleted: deletedCounts, totalDeleted, durationMs };
}

// CLI execution
const scriptFile = fileURLToPath(import.meta.url);
function fileURLToPath(url) {
  return new URL(url).pathname.replace(/^\/([A-Z]:)/, "$1").replace(/%20/g, " ");
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(scriptFile).toLowerCase()) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const includeUsers = args.includes("--users") || args.includes("--all");
  const quiet = args.includes("--quiet");

  cleanE2EData({ dryRun, includeUsers, quiet });
}
