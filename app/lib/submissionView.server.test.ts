import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import type { SubmissionPayload } from "./submission.server";
import { countChanges, describeSubmissionChanges } from "./submissionView.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

describe("submission review view", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  beforeEach(() => {
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec(`
      ALTER TABLE route ADD COLUMN updated_at TIMESTAMP;
      ALTER TABLE route ADD COLUMN crag_name TEXT;
      ALTER TABLE route ADD COLUMN sector_name TEXT;
    `);
    for (const migration of ["0062_add_raw_topos.sql", "0063_add_topo_coordinates.sql"]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO crag (id, name) VALUES (1, 'Grassi Lakes');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Golf Course', 1), (11, 'Lower Wall', 1);
      INSERT INTO route (id, name, sector_id, grade_yds, bolt_count, crag_name, sector_name)
        VALUES (100, 'Me & My Shadow', 10, '5.10b', 6, 'Grassi Lakes', 'Golf Course'),
               (101, 'Other Line', 10, '5.9', 4, 'Grassi Lakes', 'Golf Course');
      INSERT INTO topo (id, uuid, name, sector_id, crag_id, background_image_url, raster_image_url)
        VALUES (7, 'topo-7', 'Golf Course Left', 10, 1, 'bg.jpg', 'raster-old.jpg');
      INSERT INTO route_topo (topo_id, route_id, label, sort_order) VALUES (7, 100, '1', 1);
    `);
  });

  it("shows an edit as current and proposed values for the fields that would change", async () => {
    const payload: SubmissionPayload = {
      changes: [{ entity: "route", op: "update", id: 100, fields: { gradeYds: "5.10c", boltCount: 6, sectorId: 11, notes: "<p>New</p>" } }],
    };

    const [change] = await describeSubmissionChanges(db, payload);

    expect(change).toEqual(expect.objectContaining({
      title: "Edit route “Me & My Shadow”",
      location: "Grassi Lakes › Golf Course",
      unchangedCount: 1,
      missing: false,
    }));
    expect(change.fields).toEqual([
      { name: "gradeYds", label: "Grade", current: { kind: "text", text: "5.10b" }, proposed: { kind: "text", text: "5.10c" } },
      {
        name: "sectorId",
        label: "Sector",
        current: { kind: "record", record: { entity: "sector", id: 10, label: "Golf Course", isNew: false } },
        proposed: { kind: "record", record: { entity: "sector", id: 11, label: "Lower Wall", isNew: false } },
      },
      { name: "notes", label: "Notes", current: { kind: "empty" }, proposed: { kind: "richText", html: "<p>New</p>" } },
    ]);
  });

  it("reads current values live, so an edit that's since been applied shows nothing to change", async () => {
    const payload: SubmissionPayload = { changes: [{ entity: "route", op: "update", id: 100, fields: { gradeYds: "5.10c" } }] };
    sqlite.exec("UPDATE route SET grade_yds = '5.10c' WHERE id = 100");

    const [change] = await describeSubmissionChanges(db, payload);

    expect(change.fields).toEqual([]);
    expect(change.unchangedCount).toBe(1);
  });

  it("names new parents by the records created earlier in the submission", async () => {
    const payload: SubmissionPayload = {
      changes: [
        { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: 1 } },
        { ref: "r1", entity: "route", op: "create", fields: { name: "New Line", sectorId: "s1" } },
      ],
    };

    const [sector, route] = await describeSubmissionChanges(db, payload);

    expect(sector.title).toBe("New sector “Main Wall”");
    expect(sector.fields[1].proposed).toEqual({ kind: "record", record: { entity: "crag", id: 1, label: "Grassi Lakes", isNew: false } });
    expect(route.fields[1].proposed).toEqual({ kind: "record", record: { entity: "sector", id: null, label: "Main Wall", isNew: true } });
    expect(countChanges(payload)).toEqual({ creates: 2, edits: 0 });
  });

  it("shows a topo's images and linked routes, with the current links by name", async () => {
    const payload: SubmissionPayload = {
      changes: [
        { ref: "r1", entity: "route", op: "create", fields: { name: "New Line", sectorId: 10 } },
        {
          entity: "topo",
          op: "update",
          id: 7,
          fields: { raster: "raster-new.jpg", routes: [{ routeId: 100, label: "1" }, { routeId: "r1", label: "2" }] },
        },
      ],
    };

    const [, topo] = await describeSubmissionChanges(db, payload);

    expect(topo.location).toBe("Grassi Lakes › Golf Course");
    expect(topo.fields).toEqual([
      { name: "raster", label: "Topo image", current: { kind: "image", url: "raster-old.jpg" }, proposed: { kind: "image", url: "raster-new.jpg" } },
      {
        name: "routes",
        label: "Routes on topo",
        current: { kind: "routes", routes: [{ label: "1", record: { entity: "route", id: 100, label: "Me & My Shadow", isNew: false } }] },
        proposed: {
          kind: "routes",
          routes: [
            { label: "1", record: { entity: "route", id: 100, label: "Me & My Shadow", isNew: false } },
            { label: "2", record: { entity: "route", id: null, label: "New Line", isNew: true } },
          ],
        },
      },
    ]);
  });

  it("flags an edit whose record no longer exists", async () => {
    const [change] = await describeSubmissionChanges(db, {
      changes: [{ entity: "route", op: "update", id: 999, fields: { name: "Gone" } }],
    });

    expect(change).toEqual(expect.objectContaining({ title: "Edit route 999", missing: true }));
  });
});
