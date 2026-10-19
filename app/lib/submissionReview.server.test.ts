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

import { getSubmissionStatus } from "./submission.server";
import { approveSubmission, rejectSubmission } from "./submissionReview.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const reviewer = { uid: "admin", displayName: "Admin" };

const multiLevel = {
  changes: [
    { ref: "c1", entity: "crag", op: "create", fields: { name: "New Crag" } },
    { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: "c1" } },
    { ref: "r1", entity: "route", op: "create", fields: { name: "New Line", sectorId: "s1", gradeYds: "5.11a" } },
    { entity: "route", op: "update", id: 100, fields: { boltCount: 7 } },
    {
      ref: "t1",
      entity: "topo",
      op: "create",
      fields: {
        uuid: "topo-new",
        name: "Main Wall Left",
        sectorId: "s1",
        background: "https://topos.example.com/submissions/sub/bg.jpg",
        raster: "https://topos.example.com/submissions/sub/raster.png",
        annotations: { version: 1, items: [{ id: "line-1", routeId: 100 }, { id: "line-2", kind: "climbLine", routeId: "r1" }, { id: "walkoff-1" }] },
        routes: [{ routeId: 100, label: "1" }, { routeId: "r1", label: "2" }],
      },
    },
  ],
};

describe("submission review", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  function queue(id: string, payload: unknown) {
    sqlite.exec(`INSERT INTO submission (id, uid, source, payload) VALUES ('${id}', 'submitter', 'topobuilder', '${JSON.stringify(payload)}')`);
  }

  async function auditRows() {
    const rows = await db.selectFrom("audit_log").selectAll().orderBy("id").execute();
    return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    sqlite.exec("ALTER TABLE crag ADD COLUMN slug TEXT");
    for (const migration of [
      "0062_add_raw_topos.sql", "0063_add_topo_coordinates.sql", "0070_add_audit_log.sql", "0071_replace_topo_submission.sql",
    ]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO user (uid, display_name) VALUES ('submitter', 'Submitter'), ('admin', 'Admin');
      INSERT INTO crag (id, name, slug) VALUES (1, 'Crag', 'crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1);
      INSERT INTO route (id, name, sector_id, bolt_count) VALUES (100, 'Route', 10, 6);
    `);
    mocks.getDB.mockReturnValue(db);
  });

  it("approves a multi-level submission, logs each change, and removes it from the queue", async () => {
    queue("sub", multiLevel);

    const result = await approveSubmission(createContext(), { id: "sub", reviewer });

    const crag = await db.selectFrom("crag").selectAll().where("name", "=", "New Crag").executeTakeFirstOrThrow();
    const sector = await db.selectFrom("sector").selectAll().where("name", "=", "Main Wall").executeTakeFirstOrThrow();
    const route = await db.selectFrom("route").selectAll().where("name", "=", "New Line").executeTakeFirstOrThrow();
    const topo = await db.selectFrom("topo").selectAll().where("uuid", "=", "topo-new").executeTakeFirstOrThrow();
    expect(result).toEqual({ ok: true, ids: { c1: crag.id, s1: sector.id, r1: route.id, t1: topo.id } });
    expect(crag.slug).toBe("new-crag");
    expect(sector.crag_id).toBe(crag.id);
    expect(route).toEqual(expect.objectContaining({ sector_id: sector.id, grade_yds: "5.11a" }));
    expect(topo).toEqual(expect.objectContaining({ sector_id: sector.id, raster_image_url: "https://topos.example.com/submissions/sub/raster.png" }));
    // Annotations drawn for a new route point at its published id, not the submission's ref.
    expect(JSON.parse(topo.annotations_json)).toEqual({
      version: 1,
      items: [{ id: "line-1", routeId: 100 }, { id: "line-2", kind: "climbLine", routeId: route.id }, { id: "walkoff-1" }],
    });
    expect(await db.selectFrom("route_topo").select(["route_id", "label"]).orderBy("sort_order").execute())
      .toEqual([{ route_id: 100, label: "1" }, { route_id: route.id, label: "2" }]);
    expect(await db.selectFrom("route").select("bolt_count").where("id", "=", 100).executeTakeFirst()).toEqual({ bolt_count: 7 });

    const rows = await auditRows();
    expect(rows.map((row) => [row.entity, row.action, row.ref])).toEqual([
      ["crag", "create", "c1"], ["sector", "create", "s1"], ["route", "create", "r1"], ["route", "update", null], ["topo", "create", "t1"],
    ]);
    for (const row of rows) {
      expect(row).toEqual(expect.objectContaining({
        author_uid: "submitter", author_name: "Submitter", reviewer_uid: "admin", reviewer_name: "Admin",
        decision: "approved", source: "topobuilder", submission_id: "sub",
      }));
    }
    expect(rows[3]).toEqual(expect.objectContaining({ entity_id: 100, changes: { bolt_count: [6, 7] } }));
    expect(await db.selectFrom("submission").select("id").execute()).toEqual([]);

    expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "sub" }))
      .toEqual({ id: "sub", status: "approved", ids: result.ok ? result.ids : {} });
  });

  it("keeps a failed approval queued with its error, and approving again doesn't repeat creates or updates", async () => {
    queue("sub", {
      changes: [
        { ref: "c1", entity: "crag", op: "create", fields: { name: "New Crag" } },
        { entity: "sector", op: "update", id: 10, fields: { name: "Updated Sector" } },
        { entity: "route", op: "update", id: 100, fields: { boltCount: 7 } },
      ],
    });
    sqlite.exec(`CREATE TRIGGER block_route_update BEFORE UPDATE ON route BEGIN SELECT RAISE(ABORT, 'Route is locked'); END;`);

    expect(await approveSubmission(createContext(), { id: "sub", reviewer })).toEqual({ ok: false, error: "Route is locked" });
    const queued = await db.selectFrom("submission").selectAll().executeTakeFirstOrThrow();
    expect(queued.error).toBe("Route is locked");
    const cragId = (await db.selectFrom("crag").select("id").where("name", "=", "New Crag").executeTakeFirstOrThrow()).id;
    expect(JSON.parse(queued.payload).changes).toEqual([
      expect.objectContaining({ ref: "c1", id: cragId, applied: true }),
      expect.objectContaining({ entity: "sector", id: 10, applied: true }),
      expect.not.objectContaining({ applied: true }),
    ]);

    sqlite.exec("DROP TRIGGER block_route_update");
    expect(await approveSubmission(createContext(), { id: "sub", reviewer })).toEqual({ ok: true, ids: { c1: cragId } });
    expect(await db.selectFrom("crag").select("id").where("name", "=", "New Crag").execute()).toHaveLength(1);
    expect((await auditRows()).map((row) => [row.entity, row.action])).toEqual([
      ["crag", "create"],
      ["sector", "update"],
      ["route", "update"],
    ]);
    expect(await db.selectFrom("submission").select("id").execute()).toEqual([]);
  });

  it("fails clearly when an edited record was removed after the submission arrived", async () => {
    queue("sub", { changes: [{ entity: "route", op: "update", id: 100, fields: { boltCount: 7 } }] });
    sqlite.exec("DELETE FROM route WHERE id = 100");

    expect(await approveSubmission(createContext(), { id: "sub", reviewer }))
      .toEqual({ ok: false, error: "route 100 no longer exists." });
    expect(await auditRows()).toEqual([]);
  });

  it("rejects a submission by logging each proposed change against current values", async () => {
    queue("sub", multiLevel);

    expect(await rejectSubmission(createContext(), { id: "sub", reviewer })).toEqual({ ok: true, ids: {} });

    expect(await db.selectFrom("crag").select("id").execute()).toEqual([{ id: 1 }]);
    expect(await db.selectFrom("route").select("bolt_count").where("id", "=", 100).executeTakeFirst()).toEqual({ bolt_count: 6 });
    expect(await db.selectFrom("submission").select("id").execute()).toEqual([]);

    const rows = await auditRows();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toEqual(expect.objectContaining({ decision: "rejected", author_uid: "submitter", reviewer_uid: "admin", submission_id: "sub" }));
    }
    expect(rows[1]).toEqual(expect.objectContaining({
      entity: "sector", entity_id: null, action: "create", ref: "s1",
      changes: { name: [null, "Main Wall"], crag_id: [null, "c1"] },
    }));
    expect(rows[3]).toEqual(expect.objectContaining({ entity_id: 100, action: "update", changes: { bolt_count: [6, 7] } }));
    expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "sub" }))
      .toEqual({ id: "sub", status: "rejected", ids: {} });
  });

  it("updates image hashes and clears stale dimensions when a submission replaces a topo's images", async () => {
    const newBgHash = "a".repeat(40);
    const newRasterHash = "b".repeat(40);
    sqlite.exec(`
      INSERT INTO topo (
        id, uuid, name, background_image_url, background_image_hash,
        raster_image_url, raster_image_hash, image_width, image_height, image_file_size
      ) VALUES (
        7, 'topo-7', 'Wall', 'https://topos.example.com/old-bg.jpg', 'old-bg-hash',
        'https://topos.example.com/old-raster.png', 'old-raster-hash', 1920, 1080, 50000
      );
    `);
    queue("sub", {
      changes: [{
        entity: "topo",
        op: "update",
        id: 7,
        fields: {
          background: `https://topos.example.com/submissions/sub/${newBgHash}.jpg`,
          raster: `https://topos.example.com/submissions/sub/${newRasterHash}.png`,
        },
      }],
    });

    expect(await approveSubmission(createContext(), { id: "sub", reviewer })).toEqual({ ok: true, ids: {} });

    const topo = await db.selectFrom("topo").selectAll().where("id", "=", 7).executeTakeFirstOrThrow();
    expect(topo).toEqual(expect.objectContaining({
      background_image_hash: newBgHash,
      raster_image_hash: newRasterHash,
      image_width: null,
      image_height: null,
      image_file_size: null,
    }));
  });

  it("refuses a submission that's already been decided", async () => {
    expect(await approveSubmission(createContext(), { id: "gone", reviewer }))
      .toEqual({ ok: false, error: "This submission has already been decided or doesn't exist." });
    expect(await rejectSubmission(createContext(), { id: "gone", reviewer }))
      .toEqual({ ok: false, error: "This submission has already been decided or doesn't exist." });
  });
});
