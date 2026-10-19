import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createContext, createImageFile } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  uploadFileToR2: vi.fn(),
  deleteFromR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/s3.server", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
  deleteFromR2: mocks.deleteFromR2,
}));

import {
  listMyObjects,
  parseSubmissionRequest,
  receiveObjects,
  SubmissionValidationError,
} from "./submission.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const image = (name: string, type = "image/jpeg") => createImageFile(name, { type });

const newCrag = { entity: "crag", ref: "c1", fields: { name: "New Crag" } };
const newSector = { entity: "sector", ref: "s1", fields: { name: "Main Wall", cragId: "c1" } };
const newRoute = { entity: "route", ref: "r1", fields: { name: "New Line", sectorId: "s1", gradeYds: "5.11a" } };

describe("submission intake", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  const submit = (objects: unknown[], options: { uid?: string; files?: Map<string, File> } = {}) =>
    receiveObjects(createContext(), {
      uid: options.uid ?? "submitter",
      source: "topobuilder",
      payload: { objects },
      files: options.files ?? new Map(),
    });

  async function stored(uid = "submitter") {
    const rows = await db.selectFrom("submission").selectAll().where("uid", "=", uid).orderBy("id").execute();
    return rows.map((row) => ({ ...row, fields: JSON.parse(row.fields) }));
  }

  function publish(entity: string, ref: string, targetId: number) {
    sqlite.exec(`
      INSERT INTO submission (uid, source, entity, ref, target_id, fields, state, received_at, updated_at)
      VALUES ('submitter', 'topobuilder', '${entity}', '${ref}', ${targetId}, '{}', 'published', '2026-10-01 00:00:00', '2026-10-01 00:00:00');
    `);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    for (const migration of ["0062_add_raw_topos.sql", "0063_add_topo_coordinates.sql", "0072_submission_per_object.sql"]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO user (uid, display_name) VALUES ('submitter', 'Submitter'), ('someone-else', 'Other');
      INSERT INTO crag (id, name) VALUES (1, 'Crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1);
      INSERT INTO route (id, name, sector_id, bolt_count) VALUES (100, 'Route', 10, 6);
      INSERT INTO topo (id, uuid, name, background_image_url, raster_image_url) VALUES (7, 'topo-existing', 'Topo', 'bg.jpg', 'raster.jpg');
    `);
    mocks.getDB.mockReturnValue(db);
    mocks.uploadFileToR2.mockImplementation(async (_context, file: File, _bucket, domain: string, options) => ({
      url: `${domain}/${options.keyPrefix}/${file.name}`,
      name: `${options.keyPrefix}/${file.name}`,
      type: file.type,
    }));
  });

  it("stores one pending proposal per object, with uploaded files and refs to new parents", async () => {
    const result = await submit(
      [
        newCrag,
        newSector,
        newRoute,
        { entity: "route", id: 100, baseUpdatedAt: "2026-06-09 10:00:00", fields: { boltCount: 7 } },
        {
          entity: "topo",
          ref: "t1",
          fields: {
            uuid: "topo-new", name: "Main Wall Left", sectorId: "s1", background: "file:bg", raster: "file:raster",
            annotations: { version: 1, items: [{ id: "a1", routeId: "r1" }] }, routes: [{ routeId: "r1", label: "1" }],
          },
        },
      ],
      { files: new Map([["bg", createImageFile("bg.jpg", { width: 4032, height: 3024 })], ["raster", image("raster.png", "image/png")]]) },
    );

    expect(result.map((object) => object.state)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
    const rows = await stored();
    expect(rows.map((row) => [row.entity, row.ref, row.target_id, row.state])).toEqual([
      ["crag", "c1", null, "pending"],
      ["sector", "s1", null, "pending"],
      ["route", "r1", null, "pending"],
      ["route", null, 100, "pending"],
      ["topo", "t1", null, "pending"],
    ]);
    expect(rows[1].fields).toEqual({ name: "Main Wall", cragId: "c1" });
    expect(rows[3]).toMatchObject({ fields: { boltCount: 7 }, base_updated_at: "2026-06-09 10:00:00" });
    expect(rows[4].fields).toMatchObject({
      background: "https://topos.example.com/submissions/submitter/bg.jpg",
      raster: "https://topos.example.com/submissions/submitter/raster.png",
      imageWidth: 4032,
      imageHeight: 3024,
    });
  });

  it("merges a resubmitted object field by field, the newest value winning", async () => {
    await submit([newCrag, newSector, newRoute]);
    await submit([{ entity: "route", ref: "r1", fields: { gradeYds: "5.11b", boltCount: 8 } }]);

    const route = (await stored()).find((row) => row.ref === "r1");
    expect(route?.fields).toEqual({ name: "New Line", sectorId: "s1", gradeYds: "5.11b", boltCount: 8 });
  });

  it("keeps one proposal per object however overlapping submissions arrive", async () => {
    await submit([newCrag, newSector, newRoute]);
    await submit([newSector, newRoute]);
    await submit([newRoute]);
    await submit([newCrag, newSector, newRoute, { entity: "sector", ref: "s2", fields: { name: "Upper Wall", cragId: "c1" } }]);

    expect((await stored()).map((row) => row.ref)).toEqual(["c1", "s1", "r1", "s2"]);
  });

  it("treats an identical retry as a no-op", async () => {
    await submit([newCrag, newSector, newRoute]);
    const before = await stored();

    expect((await submit([newCrag, newSector, newRoute])).map((object) => object.state)).toEqual(["pending", "pending", "pending"]);
    expect((await stored()).map((row) => [row.id, row.fields])).toEqual(before.map((row) => [row.id, row.fields]));
  });

  it("turns an object you already published into an edit, and drops one that changes nothing", async () => {
    publish("route", "r1", 100);

    expect(await submit([{ entity: "route", ref: "r1", fields: { name: "Route", sectorId: 10 } }]))
      .toEqual([{ entity: "route", ref: "r1", id: 100, state: "unchanged" }]);
    expect((await stored())[0].state).toBe("published");

    await submit([{ entity: "route", ref: "r1", fields: { boltCount: 7 } }]);
    expect(await stored()).toEqual([expect.objectContaining({ ref: "r1", target_id: 100, state: "pending", fields: { boltCount: 7 } })]);
  });

  it("stores references to your published objects as their record ids", async () => {
    publish("sector", "s1", 10);

    await submit([{ entity: "route", ref: "r2", fields: { name: "Another Line", sectorId: "s1" } }]);

    expect((await stored()).find((row) => row.ref === "r2")?.fields.sectorId).toBe(10);
  });

  it("proposes a rejected object again from scratch", async () => {
    sqlite.exec(`
      INSERT INTO submission (uid, source, entity, ref, fields, state, received_at, decided_at, updated_at)
      VALUES ('submitter', 'topobuilder', 'crag', 'c1', '{"name":"Spam"}', 'rejected', '2026-10-01', '2026-10-02', '2026-10-02');
    `);

    await submit([{ entity: "crag", ref: "c1", fields: { name: "Real Crag" } }]);

    expect(await stored()).toEqual([expect.objectContaining({ state: "pending", fields: { name: "Real Crag" }, decided_at: null })]);
  });

  describe("withdrawing", () => {
    it("removes a new object's proposal, and leaves a published object published", async () => {
      await submit([newCrag]);
      publish("route", "r1", 100);
      await submit([{ entity: "route", ref: "r1", fields: { boltCount: 9 } }]);

      expect(await submit([{ entity: "crag", ref: "c1", withdraw: true }, { entity: "route", ref: "r1", withdraw: true }]))
        .toEqual([
          { entity: "crag", ref: "c1", id: null, state: "withdrawn" },
          { entity: "route", ref: "r1", id: 100, state: "withdrawn" },
        ]);
      expect(await stored()).toEqual([expect.objectContaining({ ref: "r1", state: "published" })]);
    });

    it("refuses to strand a pending child", async () => {
      await submit([newCrag, newSector]);

      await expect(submit([{ entity: "crag", ref: "c1", withdraw: true }]))
        .rejects.toThrow('your pending sector "s1" fields.cragId refers to "c1"');
      expect(await stored()).toHaveLength(2);
    });
  });

  it("stores text containing HTML entities so the DB's entity decoding can't alter it", async () => {
    await submit([{ entity: "route", id: 100, fields: { notes: '<p>Tom &amp; "Jerry" &quot;</p>' } }]);

    const { fields } = await db.selectFrom("submission").select("fields").executeTakeFirstOrThrow();
    expect(fields).not.toContain("&");
    expect(JSON.parse(fields).notes).toBe('<p>Tom &amp; "Jerry" &quot;</p>');
  });

  it.each([
    ["an empty object list", [], "at least one object"],
    ["both a ref and an id", [{ entity: "route", ref: "r1", id: 100, fields: { name: "X" } }], "needs either a ref"],
    ["an unknown entity", [{ entity: "area", ref: "a1", fields: { name: "X" } }], "objects[0].entity must be one of"],
    ["an unknown field", [{ entity: "route", id: 100, fields: { grade: "5.9" } }], "objects[0].fields.grade is not an editable route field"],
    ["a wrongly typed field", [{ entity: "route", id: 100, fields: { boltCount: "7" } }], "boltCount must be an integer or null"],
    ["fields on a withdrawal", [{ entity: "route", ref: "r1", withdraw: true, fields: { name: "X" } }], "fields isn't allowed when withdrawing"],
    ["the same object twice", [newCrag, newCrag], "objects[1] repeats an object"],
    ["a new object missing required fields", [{ entity: "route", ref: "r9", fields: { name: "Line" } }], "fields.sectorId is required for a new route"],
    ["a ref to an object you haven't proposed", [{ entity: "route", ref: "r9", fields: { name: "Line", sectorId: "nope" } }], 'fields.sectorId refers to "nope", which isn\'t a sector you\'ve proposed'],
    ["a ref to the wrong kind of object", [newCrag, { entity: "route", ref: "r9", fields: { name: "Line", sectorId: "c1" } }], "which is your crag, not a sector"],
    ["an edit of a record that doesn't exist", [{ entity: "route", id: 999, fields: { name: "X" } }], "objects[0] refers to route 999, which doesn't exist"],
    ["a parent that doesn't exist", [{ entity: "route", ref: "r9", fields: { name: "Line", sectorId: 55 } }], "fields.sectorId refers to sector 55"],
    ["an annotation naming an unknown route", [{ entity: "topo", id: 7, fields: { annotations: { version: 1, items: [{ routeId: "local-9" }] } } }], 'annotations.items[0].routeId refers to "local-9"'],
    ["a missing file part", [{ entity: "topo", id: 7, fields: { raster: "file:nope" } }], 'missing file part "nope"'],
    ["a file value that isn't a placeholder", [{ entity: "topo", id: 7, fields: { raster: "https://elsewhere/x.jpg" } }], "reference to an uploaded file"],
    ["a new topo reusing an existing uuid", [{ entity: "topo", ref: "t9", fields: { uuid: "topo-existing", name: "Again", background: "file:bg", raster: "file:raster" } }], '"topo-existing" belongs to topo 7'],
    ["a topo uuid change", [{ entity: "topo", id: 7, fields: { uuid: "other" } }], "fields.uuid can't be changed"],
    ["an unknown topo status", [{ entity: "topo", id: 7, fields: { status: "Retired" } }], "fields.status must be one of Active, Deleted"],
    ["an image size sent by the app", [{ entity: "topo", id: 7, fields: { imageWidth: 800 } }], "fields.imageWidth is measured from the background image"],
  ])("rejects %s, storing nothing", async (_label, objects, message) => {
    const attempt = submit(objects as unknown[], { files: new Map([["bg", image("bg.jpg")], ["raster", image("raster.jpg")]]) });

    await expect(attempt).rejects.toBeInstanceOf(SubmissionValidationError);
    await expect(attempt).rejects.toThrow(message);
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    expect(await stored()).toEqual([]);
  });

  it("rejects an image it can't measure, before storing anything", async () => {
    const attempt = submit(
      [{ entity: "topo", id: 7, fields: { background: "file:bg" } }],
      { files: new Map([["bg", new File(["not an image"], "bg.jpg", { type: "image/jpeg" })]]) },
    );

    await expect(attempt).rejects.toThrow("objects[0].fields.background isn't a readable image");
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
  });

  it("rejects files that aren't images", async () => {
    const attempt = submit(
      [{ entity: "topo", id: 7, fields: { raster: "file:raster" } }],
      { files: new Map([["raster", image("raster.pdf", "application/pdf")]]) },
    );

    await expect(attempt).rejects.toThrow('unsupported file type "application/pdf"');
  });

  it("removes newly uploaded files when the proposals can't be stored", async () => {
    const attempt = submit(
      [{ entity: "topo", id: 7, fields: { raster: "file:raster" } }],
      { uid: "no-such-user", files: new Map([["raster", image("raster.png", "image/png")]]) },
    );

    await expect(attempt).rejects.toThrow("FOREIGN KEY");
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(expect.anything(), "topos", "submissions/no-such-user/raster.png");
  });

  it("reads a JSON body or a multipart submission with file parts", async () => {
    const json = await parseSubmissionRequest(new Request("https://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: [] }),
    }));
    expect(json).toEqual({ payload: { objects: [] }, files: new Map() });

    const formData = new FormData();
    formData.append("submission", JSON.stringify({ objects: [newCrag] }));
    formData.append("bg", image("bg.jpg"));
    const multipart = await parseSubmissionRequest(new Request("https://example.com", { method: "POST", body: formData }));
    expect(multipart.payload).toEqual({ objects: [newCrag] });
    expect([...multipart.files.keys()]).toEqual(["bg"]);

    await expect(parseSubmissionRequest(new Request("https://example.com", { method: "POST", body: "{nope" })))
      .rejects.toThrow("must be valid JSON");
  });

  describe("my objects", () => {
    it("lists the caller's objects, changed since the cursor, and no one else's", async () => {
      await submit([newCrag]);
      await submit([{ entity: "crag", ref: "theirs", fields: { name: "Theirs" } }], { uid: "someone-else" });
      sqlite.exec("UPDATE submission SET updated_at = '2026-10-01 00:00:00' WHERE ref = 'c1'");
      publish("route", "r1", 100);
      sqlite.exec("UPDATE submission SET updated_at = '2026-10-05 00:00:00', decided_at = '2026-10-05 00:00:00' WHERE ref = 'r1'");

      const all = await listMyObjects(createContext(), { uid: "submitter", since: null });
      expect(all.objects).toEqual([
        expect.objectContaining({ entity: "crag", ref: "c1", id: null, state: "pending", fields: { name: "New Crag" } }),
        expect.objectContaining({ entity: "route", ref: "r1", id: 100, state: "published", decidedAt: "2026-10-05 00:00:00" }),
      ]);
      expect(all.serverTime).toBe("2026-10-05 00:00:00");

      const recent = await listMyObjects(createContext(), { uid: "submitter", since: "2026-10-02 00:00:00" });
      expect(recent.objects.map((object) => object.ref)).toEqual(["r1"]);
    });
  });
});
