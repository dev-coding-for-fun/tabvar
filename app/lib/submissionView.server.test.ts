import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createSubmissionObject as object } from "~/test/helpers";
import { countChanges, describeObjects } from "./submissionView.server";

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
    const edit = object({
      entity: "route",
      targetId: 100,
      fields: { gradeYds: "5.10c", boltCount: 6, sectorId: 11, notes: "<p>New</p>" },
      error: "Route 100 is locked",
    });

    const [change] = await describeObjects(db, [edit]);

    expect(change).toEqual(expect.objectContaining({
      key: edit.id,
      isNew: false,
      title: "Edit route “Me & My Shadow”",
      location: "Grassi Lakes › Golf Course",
      unchangedCount: 1,
      missing: false,
      error: "Route 100 is locked",
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
    sqlite.exec("UPDATE route SET grade_yds = '5.10c' WHERE id = 100");

    const [change] = await describeObjects(db, [object({ entity: "route", targetId: 100, fields: { gradeYds: "5.10c" } })]);

    expect(change.fields).toEqual([]);
    expect(change.unchangedCount).toBe(1);
  });

  it("names new parents by the other objects in the chain", async () => {
    const objects = [
      object({ entity: "sector", ref: "s1", fields: { name: "Main Wall", cragId: 1 } }),
      object({ entity: "route", ref: "r1", fields: { name: "New Line", sectorId: "s1" } }),
    ];

    const [sector, route] = await describeObjects(db, objects);

    expect(sector).toMatchObject({ title: "New sector “Main Wall”", isNew: true, ref: "s1" });
    expect(sector.fields[1].proposed).toEqual({ kind: "record", record: { entity: "crag", id: 1, label: "Grassi Lakes", isNew: false } });
    expect(route.fields[1].proposed).toEqual({ kind: "record", record: { entity: "sector", id: null, label: "Main Wall", isNew: true } });
    expect(countChanges(objects)).toEqual({ creates: 2, edits: 0 });
  });

  it("shows a topo's images and linked routes, with the current links by name", async () => {
    const objects = [
      object({ entity: "route", ref: "r1", fields: { name: "New Line", sectorId: 10 } }),
      object({
        entity: "topo",
        targetId: 7,
        fields: { raster: "raster-new.jpg", routes: [{ routeId: 100, label: "1" }, { routeId: "r1", label: "2" }] },
      }),
    ];

    const [, topo] = await describeObjects(db, objects);

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
    const [change] = await describeObjects(db, [object({ entity: "route", targetId: 999, fields: { name: "Gone" } })]);

    expect(change).toEqual(expect.objectContaining({ title: "Edit route 999", missing: true }));
  });
});
