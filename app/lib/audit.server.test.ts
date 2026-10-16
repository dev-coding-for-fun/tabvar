import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createContext } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { auditCreatedRows, auditedWrite, writeAudit } from "./audit.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const author = { uid: "editor-1", displayName: "Editor" };

describe("audit log", () => {
  let db: Kysely<DB>;

  async function auditRows() {
    const rows = await db.selectFrom("audit_log").selectAll().orderBy("id").execute();
    return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    const sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    // Added by later migrations that this test doesn't otherwise need; the topo triggers use it.
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    for (const migration of ["0062_add_raw_topos.sql", "0070_add_audit_log.sql"]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO crag (id, name) VALUES (1, 'Crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector A', 1), (11, 'Sector B', 1);
      INSERT INTO route (id, name, sector_id, grade_yds, bolt_count) VALUES (100, 'Route', 10, '5.10a', 6);
      INSERT INTO topo (id, uuid, name, background_image_url, raster_image_url) VALUES (7, 'topo-7', 'Topo', 'bg.jpg', 'raster.jpg');
    `);
    mocks.getDB.mockReturnValue(db);
  });

  it("logs only the columns an update changed, as a direct edit", async () => {
    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "route",
      ids: [100],
      write: () => db.updateTable("route")
        .set({ name: "Route", grade_yds: "5.10b", sector_id: 11 })
        .where("id", "=", 100)
        .execute(),
    });

    expect(await auditRows()).toEqual([expect.objectContaining({
      author_uid: "editor-1",
      author_name: "Editor",
      reviewer_uid: null,
      reviewer_name: null,
      decision: null,
      source: "web",
      entity: "route",
      entity_id: 100,
      action: "update",
      changes: { grade_yds: ["5.10a", "5.10b"], sector_id: [10, 11] },
      submission_id: null,
      ref: null,
    })]);
  });

  it("writes nothing for an edit that changes nothing or a write that failed", async () => {
    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "route",
      ids: [100],
      write: () => db.updateTable("route").set({ name: "Route" }).where("id", "=", 100).execute(),
    });
    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "route",
      ids: [100],
      write: async () => {
        await db.updateTable("route").set({ name: "Renamed" }).where("id", "=", 100).execute();
        return { success: false };
      },
      succeeded: (result) => result.success,
    });

    expect(await auditRows()).toEqual([]);
  });

  it("logs created rows with null before values", async () => {
    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "sector",
      ids: [],
      write: () => db.insertInto("sector").values({ name: "New Sector", crag_id: 1 })
        .returning("id").executeTakeFirstOrThrow(),
      createdIds: (created) => [created.id],
    });

    const [row] = await auditRows();
    expect(row).toEqual(expect.objectContaining({ entity: "sector", action: "create" }));
    expect(row.entity_id).toBeGreaterThan(11);
    expect(row.changes).toEqual({ name: [null, "New Sector"], crag_id: [null, 1] });
  });

  it("stores the whole row for a delete", async () => {
    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "route",
      ids: [100],
      write: () => db.deleteFrom("route").where("id", "=", 100).execute(),
    });

    const [row] = await auditRows();
    expect(row).toEqual(expect.objectContaining({ entity: "route", entity_id: 100, action: "delete" }));
    expect(row.changes).toEqual(expect.objectContaining({
      id: [100, null],
      name: ["Route", null],
      grade_yds: ["5.10a", null],
      bolt_count: [6, null],
    }));
  });

  it("compares a topo's route links", async () => {
    await auditedWrite(createContext(), {
      author,
      source: "api",
      entity: "topo",
      ids: [7],
      write: () => db.insertInto("route_topo")
        .values({ topo_id: 7, route_id: 100, label: "1", sort_order: 1 })
        .execute(),
    });

    const [row] = await auditRows();
    expect(row.changes).toEqual({ routes: [[], [{ route_id: 100, label: "1", sort_order: 1 }]] });
  });

  it("logs every row of a write larger than one D1 query allows", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => 1000 + index);
    await db.insertInto("route").values(ids.map((id) => ({ id, name: `Route ${id}`, sector_id: 10 }))).execute();

    await auditedWrite(createContext(), {
      author,
      source: "web",
      entity: "route",
      ids,
      write: () => db.updateTable("route").set({ sort_order: 1 }).where("id", "in", ids).execute(),
    });

    const rows = await auditRows();
    expect(rows.map((row) => row.entity_id)).toEqual(ids);
    expect(rows.every((row) => row.changes.sort_order[1] === 1)).toBe(true);
  });

  it("logs rows created as a side effect", async () => {
    await auditCreatedRows(createContext(), { author, source: "api", entity: "route", ids: [100] });

    const [row] = await auditRows();
    expect(row).toEqual(expect.objectContaining({ source: "api", entity: "route", entity_id: 100, action: "create" }));
    expect(row.changes).toEqual(expect.objectContaining({ name: [null, "Route"], sector_id: [null, 10] }));
  });

  it("records reviewer, decision, submission, and ref for reviewed changes", async () => {
    await writeAudit(db, [{
      author: { uid: "submitter-1", displayName: "Submitter" },
      reviewer: { uid: "admin-1", displayName: "Admin" },
      decision: "rejected",
      source: "topobuilder",
      entity: "route",
      entityId: null,
      action: "create",
      changes: { name: [null, "Proposed"] },
      submissionId: "submission-1",
      ref: "r1",
    }]);

    expect(await auditRows()).toEqual([expect.objectContaining({
      author_uid: "submitter-1",
      reviewer_uid: "admin-1",
      reviewer_name: "Admin",
      decision: "rejected",
      entity_id: null,
      submission_id: "submission-1",
      ref: "r1",
    })]);
  });
});
