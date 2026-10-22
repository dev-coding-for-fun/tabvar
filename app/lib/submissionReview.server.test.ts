import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createContext, createMemoryR2Bucket } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { approveChain, groupIntoChains, loadChain, loadPendingChains, rejectChain } from "./submissionReview.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const reviewer = { uid: "admin", displayName: "Admin" };

describe("submission review", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  /** Stores a pending proposal directly, as intake would have. Returns its id. */
  async function propose(
    entity: string,
    fields: Record<string, unknown>,
    options: { ref?: string; targetId?: number; uid?: string; state?: string } = {},
  ) {
    const row = await db.insertInto("submission").values({
      uid: options.uid ?? "submitter",
      source: "topobuilder",
      entity,
      ref: options.ref ?? null,
      target_id: options.targetId ?? null,
      fields: JSON.stringify(fields),
      state: options.state ?? "pending",
      received_at: "2026-10-01 00:00:00",
      updated_at: "2026-10-01 00:00:00",
    }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  }

  async function auditRows() {
    const rows = await db.selectFrom("audit_log").selectAll().orderBy("id").execute();
    return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
  }

  const objectRow = (id: number) => db.selectFrom("submission").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    sqlite.exec("ALTER TABLE crag ADD COLUMN slug TEXT");
    for (const migration of [
      "0062_add_raw_topos.sql", "0063_add_topo_coordinates.sql", "0070_add_audit_log.sql", "0072_submission_per_object.sql",
    ]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO user (uid, display_name) VALUES ('submitter', 'Submitter'), ('someone-else', 'Other'), ('admin', 'Admin');
      INSERT INTO crag (id, name, slug) VALUES (1, 'Crag', 'crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1);
      INSERT INTO route (id, name, sector_id, bolt_count) VALUES (100, 'Route', 10, 6);
    `);
    mocks.getDB.mockReturnValue(db);
  });

  it("groups an account's pending objects into chains linked by refs", async () => {
    const crag = await propose("crag", { name: "New Crag" }, { ref: "c1" });
    const sector = await propose("sector", { name: "Main Wall", cragId: "c1" }, { ref: "s1" });
    const route = await propose("route", { name: "New Line", sectorId: "s1" }, { ref: "r1" });
    const edit = await propose("route", { boltCount: 7 }, { targetId: 100 });
    const theirs = await propose("crag", { name: "Their Crag" }, { ref: "c1", uid: "someone-else" });

    const chains = await loadPendingChains(db);

    expect(chains.map((chain) => chain.objects.map((object) => object.id)).sort()).toEqual(
      [[crag, sector, route], [edit], [theirs]].sort(),
    );
    expect(chains.find((chain) => chain.key === crag)?.author).toEqual({ uid: "submitter", displayName: "Submitter" });
    expect((await loadChain(db, route))?.key).toBe(crag);
    expect(groupIntoChains([])).toEqual([]);
  });

  it("approves a chain parents first, publishing each object with its record id", async () => {
    const route = await propose("route", { name: "New Line", sectorId: "s1", gradeYds: "5.11a" }, { ref: "r1" });
    const topo = await propose("topo", {
      uuid: "topo-new",
      name: "Main Wall Left",
      sectorId: "s1",
      background: "https://topos.example.com/submissions/submitter/bg.jpg",
      raster: "https://topos.example.com/submissions/submitter/raster.png",
      imageWidth: 4032,
      imageHeight: 3024,
      annotations: { version: 1, items: [{ id: "line-1", routeId: "r1" }, { id: "line-2", routeId: 100 }] },
      routes: [{ routeId: 100, label: "1" }, { routeId: "r1", label: "2" }],
    }, { ref: "t1" });
    const sector = await propose("sector", { name: "Main Wall", cragId: "c1" }, { ref: "s1" });
    const crag = await propose("crag", { name: "New Crag" }, { ref: "c1" });

    expect(await approveChain(createContext(), { item: route, reviewer })).toEqual({ ok: true });

    const newCrag = await db.selectFrom("crag").selectAll().where("name", "=", "New Crag").executeTakeFirstOrThrow();
    const newSector = await db.selectFrom("sector").selectAll().where("name", "=", "Main Wall").executeTakeFirstOrThrow();
    const newRoute = await db.selectFrom("route").selectAll().where("name", "=", "New Line").executeTakeFirstOrThrow();
    const newTopo = await db.selectFrom("topo").selectAll().where("uuid", "=", "topo-new").executeTakeFirstOrThrow();
    expect(newCrag.slug).toBe("new-crag");
    expect(newSector.crag_id).toBe(newCrag.id);
    expect(newRoute).toMatchObject({ sector_id: newSector.id, grade_yds: "5.11a" });
    expect(newTopo).toMatchObject({ image_width: 4032, image_height: 3024 });
    expect(JSON.parse(newTopo.annotations_json).items).toEqual([
      { id: "line-1", routeId: newRoute.id },
      { id: "line-2", routeId: 100 },
    ]);
    expect(await db.selectFrom("route_topo").select(["route_id", "label"]).orderBy("sort_order").execute())
      .toEqual([{ route_id: 100, label: "1" }, { route_id: newRoute.id, label: "2" }]);

    for (const [id, targetId] of [[crag, newCrag.id], [sector, newSector.id], [route, newRoute.id], [topo, newTopo.id]]) {
      expect(await objectRow(id)).toMatchObject({ state: "published", target_id: targetId, error: null });
    }
    const rows = await auditRows();
    expect(rows.map((row) => [row.entity, row.action, row.ref])).toEqual([
      ["crag", "create", "c1"], ["sector", "create", "s1"], ["route", "create", "r1"], ["topo", "create", "t1"],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ author_uid: "submitter", reviewer_uid: "admin", decision: "approved", source: "topobuilder" });
    }
  });

  it("resumes after a failed approval without repeating what was published", async () => {
    const crag = await propose("crag", { name: "New Crag" }, { ref: "c1" });
    const sector = await propose("sector", { name: "Main Wall", cragId: "c1" }, { ref: "s1" });
    const route = await propose("route", { name: "New Line", sectorId: "s1" }, { ref: "r1" });
    sqlite.exec(`CREATE TRIGGER block_routes BEFORE INSERT ON route BEGIN SELECT RAISE(ABORT, 'Routes are locked'); END;`);

    expect(await approveChain(createContext(), { item: crag, reviewer })).toEqual({ ok: false, error: "Routes are locked" });
    expect(await objectRow(crag)).toMatchObject({ state: "published" });
    expect(await objectRow(sector)).toMatchObject({ state: "published" });
    expect(await objectRow(route)).toMatchObject({ state: "pending", error: "Routes are locked" });

    sqlite.exec("DROP TRIGGER block_routes");
    // The published parents have left the chain; the route alone remains and still finds its sector.
    expect(await approveChain(createContext(), { item: route, reviewer })).toEqual({ ok: true });
    const newSector = await db.selectFrom("sector").select("id").where("name", "=", "Main Wall").execute();
    expect(await db.selectFrom("crag").select("id").where("name", "=", "New Crag").execute()).toHaveLength(1);
    expect(newSector).toHaveLength(1);
    expect(await db.selectFrom("route").select("sector_id").where("name", "=", "New Line").execute())
      .toEqual([{ sector_id: newSector[0].id }]);
  });

  it("applies an edit to a published object and fails clearly when the record is gone", async () => {
    const edit = await propose("route", { boltCount: 7 }, { ref: "r1", targetId: 100 });

    expect(await approveChain(createContext(), { item: edit, reviewer })).toEqual({ ok: true });
    expect(await db.selectFrom("route").select("bolt_count").where("id", "=", 100).executeTakeFirst()).toEqual({ bolt_count: 7 });
    expect((await auditRows())[0]).toMatchObject({ action: "update", entity_id: 100, changes: { bolt_count: [6, 7] } });

    const stale = await propose("route", { name: "Ghost" }, { targetId: 999 });
    expect(await approveChain(createContext(), { item: stale, reviewer })).toEqual({ ok: false, error: "route 999 no longer exists." });
  });

  it("rejects a whole chain, recording each proposal against current values", async () => {
    const crag = await propose("crag", { name: "Spam Crag" }, { ref: "c1" });
    const sector = await propose("sector", { name: "Spam Wall", cragId: "c1" }, { ref: "s1" });

    expect(await rejectChain(createContext(), { item: sector, reviewer })).toEqual({ ok: true });

    expect(await db.selectFrom("crag").select("id").execute()).toEqual([{ id: 1 }]);
    for (const id of [crag, sector]) {
      expect(await objectRow(id)).toMatchObject({ state: "rejected", target_id: null });
    }
    expect(await auditRows()).toEqual([
      expect.objectContaining({ entity: "crag", decision: "rejected", entity_id: null, ref: "c1", changes: { name: [null, "Spam Crag"] } }),
      expect.objectContaining({ entity: "sector", decision: "rejected", ref: "s1", changes: { name: [null, "Spam Wall"], crag_id: [null, "c1"] } }),
    ]);
  });

  it("refuses an item that's already been decided", async () => {
    const published = await propose("crag", { name: "Done" }, { ref: "c1", targetId: 1, state: "published" });

    for (const review of [approveChain, rejectChain]) {
      expect(await review(createContext(), { item: published, reviewer }))
        .toEqual({ ok: false, error: "This has already been decided or doesn't exist." });
    }
  });

  describe("topo images", () => {
    const key = (prefix: string, digit: string, ext = "png") => `${prefix}/${digit.repeat(40)}.${ext}`;
    const url = (objectKey: string) => `https://topos.example.com/${objectKey}`;
    const oldBackground = key("topos/raw", "a", "jpg");
    const oldRaster = key("topos/raster", "b");
    const newBackground = key("topos/raw", "c", "jpg");
    const newRaster = key("topos/raster", "d");
    let bucket: ReturnType<typeof createMemoryR2Bucket>;
    const context = () => createContext({ TABVAR_TOPOS: bucket as unknown as R2Bucket });

    beforeEach(() => {
      bucket = createMemoryR2Bucket();
      for (const objectKey of [oldBackground, oldRaster, newBackground, newRaster]) bucket.objects.set(objectKey, new ArrayBuffer(1));
      sqlite.exec(`
        INSERT INTO topo (id, uuid, name, background_image_url, raster_image_url)
        VALUES (7, 'topo-7', 'Topo', '${url(oldBackground)}', '${url(oldRaster)}');
      `);
    });

    it("deletes the raster an approved edit replaces, and archives the old background", async () => {
      const edit = await propose(
        "topo",
        { background: url(newBackground), raster: url(newRaster), imageWidth: 800, imageHeight: 600 },
        { targetId: 7 },
      );

      expect(await approveChain(context(), { item: edit, reviewer })).toEqual({ ok: true });

      expect([...bucket.objects.keys()].sort()).toEqual([oldBackground, newBackground, newRaster].sort());
    });

    it("deletes a rejected proposal's raster and keeps its background", async () => {
      const edit = await propose("topo", { background: url(newBackground), raster: url(newRaster) }, { targetId: 7 });

      expect(await rejectChain(context(), { item: edit, reviewer })).toEqual({ ok: true });

      expect([...bucket.objects.keys()].sort()).toEqual([oldBackground, oldRaster, newBackground].sort());
    });
  });
});
