// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DirectWrite } from "~/lib/audit.server";
import type { DB } from "~/lib/db.d";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createImageFile,
  createMockDb,
  createRouteArgs,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireApiTokenUser: vi.fn(),
  uploadFileToR2: vi.fn(),
  auditedWrite: vi.fn(async (_context: unknown, change: DirectWrite<unknown>) => change.write()),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/audit.server", () => ({
  auditedWrite: mocks.auditedWrite,
}));

vi.mock("~/lib/s3.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/s3.server")>()),
  uploadFileToR2: mocks.uploadFileToR2,
}));

vi.mock("~/lib/apiAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apiAuth.server")>()),
  requireApiTokenUser: mocks.requireApiTokenUser,
}));

import { loader, action } from "./api.v1.topos";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

function tokenUser(overrides: Record<string, unknown> = {}) {
  return { tokenId: "t1", uid: "u1", client: "topobuilder", role: "member", displayName: "Mod", ...overrides };
}

describe("api.v1.topos endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser());
    mocks.uploadFileToR2.mockImplementation(async (_ctx, file, _b, domain, options) => {
      const isRaw = options?.keyPrefix?.includes("raw");
      const hash = isRaw ? "rawhash123" : "rasterhash456";
      return {
        url: `${domain}/${options?.keyPrefix}/${hash}.jpg`,
        name: `${options?.keyPrefix}/${hash}.jpg`,
        type: file.type || "image/jpeg",
        hash,
        size: 1024,
      };
    });
  });

  describe("loader (GET)", () => {
    it("returns an empty list when no topos exist", async () => {
      const db = createMockDb({
        select: [{ execute: [] }],
      });
      mocks.getDB.mockReturnValue(db);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/v1/topos"),
        context: createContext(),
        params: {},
      }));

      const body = await readJson(response);
      expect(body.topos).toEqual([]);
      expect(typeof body.serverTime).toBe("string");
    });

    it("returns topos with depicted routes, labels, and vector annotations", async () => {
      const topoRow = {
        id: 1,
        uuid: "topo-uuid-1",
        crag_id: 10,
        sector_id: 20,
        name: "Sunny Wall Overview",
        description: "Routes 1 and 2",
        background_image_url: "https://files.tabvar.org/topos/raw/rawhash.jpg",
        background_image_hash: "rawhash",
        raster_image_url: "https://files.tabvar.org/topos/raster/rasterhash.jpg",
        raster_image_hash: "rasterhash",
        image_width: 3840,
        image_height: 2160,
        image_file_size: 204800,
        annotations_json: JSON.stringify({
          version: 1,
          items: [
            { id: "a1", kind: "climbLine", color: "#FF0000", points: [{ x: 0.1, y: 0.9 }] },
          ],
        }),
        status: "Active",
        created_at: "2026-09-12 10:00:00",
        updated_at: "2026-09-12 12:00:00",
      };

      const routeRow = {
        topoId: 1,
        routeId: 101,
        label: "1",
        sortOrder: 1,
        createdAt: "2026-09-12 10:00:00",
        routeName: "Solar Flare",
      };

      const db = createMockDb({
        select: [
          { execute: [topoRow] },
          { execute: [routeRow] },
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/v1/topos?sectorId=20"),
        context: createContext(),
        params: {},
      }));

      const body = await readJson(response);
      expect(body.topos).toHaveLength(1);
      expect(body.topos[0]).toMatchObject({
        id: 1,
        uuid: "topo-uuid-1",
        name: "Sunny Wall Overview",
        backgroundImageUrl: "https://files.tabvar.org/topos/raw/rawhash.jpg",
        rasterImageUrl: "https://files.tabvar.org/topos/raster/rasterhash.jpg",
        annotations: {
          version: 1,
          items: [{ id: "a1", kind: "climbLine" }],
        },
        routes: [
          {
            topoId: 1,
            routeId: 101,
            label: "1",
            sortOrder: 1,
            routeName: "Solar Flare",
          },
        ],
      });
    });

    it("loads a single topo by id or returns 404", async () => {
      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined },
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/v1/topos?id=missing-topo"),
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(404);
      const body = await readJson(response);
      expect(body.error).toBe("not_found");
    });
  });

  describe("action (writes)", () => {
    let sqlite: InstanceType<typeof Sqlite>;
    let db: Kysely<DB>;

    const image = (name: string) => createImageFile(name);

    function post(payload: unknown, files: Record<string, File> = {}) {
      const request = Object.keys(files).length > 0
        ? createFormRequest("https://example.com/api/v1/topos", { ...files, payload: JSON.stringify(payload) })
        : new Request("https://example.com/api/v1/topos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      return action(createRouteArgs({ request, context: createContext(), params: {} })) as Promise<Response>;
    }

    function remove(query: string) {
      return action(createRouteArgs({
        request: new Request(`https://example.com/api/v1/topos?${query}`, { method: "DELETE" }),
        context: createContext(),
        params: {},
      })) as Promise<Response>;
    }

    const topoRow = () => db.selectFrom("topo").selectAll().where("id", "=", 7).executeTakeFirstOrThrow();
    const links = () => db.selectFrom("route_topo").select(["route_id", "label"]).orderBy("sort_order").execute();

    beforeEach(() => {
      sqlite = new Sqlite(":memory:");
      db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
      sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
      sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
      for (const migration of ["0062_add_raw_topos.sql", "0063_add_topo_coordinates.sql", "0072_submission_per_object.sql"]) {
        sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
      }
      sqlite.exec(`
        INSERT INTO crag (id, name) VALUES (1, 'Crag');
        INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1), (11, 'Other Sector', 1);
        INSERT INTO route (id, name, sector_id) VALUES (100, 'One', 10), (101, 'Two', 10);
        INSERT INTO topo (id, uuid, name, sector_id, description, background_image_url, raster_image_url, annotations_json, status)
          VALUES (7, 'topo-7', 'Topo', 10, 'Left side', 'https://topos.example.com/topos/raw/bg.jpg',
                  'https://topos.example.com/topos/raster/r.jpg', '{"version":1,"items":[{"id":"a1"}]}', 'Active');
        INSERT INTO route_topo (topo_id, route_id, label, sort_order) VALUES (7, 100, '1', 1);
      `);
      mocks.getDB.mockReturnValue(db);
      mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: "admin" }));
    });

    it.each(["member", "anonymous"])("sends %s to the submissions API instead of writing", async (role) => {
      mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role }));

      for (const response of [await post({ id: 7, name: "Renamed" }), await remove("id=7")]) {
        expect(response.status).toBe(403);
        expect((await readJson(response)).message).toContain("/api/topobuilder/submissions");
      }
      expect(await topoRow()).toMatchObject({ name: "Topo", status: "Active" });
    });

    it("creates a topo from uploaded images, linked to existing routes", async () => {
      const response = await post(
        // Dimensions sent by the client are ignored; they're measured from the background.
        { uuid: "topo-new", name: "New Topo", sectorId: 10, imageWidth: 1, imageHeight: 1, routes: [{ routeId: 101, label: "A" }, { routeId: 100 }] },
        { background: createImageFile("bg.jpg", { width: 4032, height: 3024 }), raster: image("raster.jpg") },
      );

      expect(response.status).toBe(201);
      const { topo } = await readJson(response);
      expect(topo).toMatchObject({
        uuid: "topo-new",
        sectorId: 10,
        backgroundImageUrl: "https://topos.example.com/topos/raw/rawhash123.jpg",
        rasterImageUrl: "https://topos.example.com/topos/raster/rasterhash456.jpg",
        imageWidth: 4032,
        imageHeight: 3024,
        status: "Active",
      });
      expect(topo.routes.map((route: { routeId: number }) => route.routeId)).toEqual([101, 100]);
    });

    it("keeps every field an update leaves out, including a deleted status", async () => {
      sqlite.exec("UPDATE topo SET status = 'Deleted' WHERE id = 7");

      const response = await post({ id: 7, name: "Renamed" });

      expect(response.status).toBe(200);
      expect(await topoRow()).toMatchObject({
        name: "Renamed",
        sector_id: 10,
        description: "Left side",
        annotations_json: '{"version":1,"items":[{"id":"a1"}]}',
        status: "Deleted",
      });
      expect(await links()).toEqual([{ route_id: 100, label: "1" }]);
    });

    it("clears fields sent as null and replaces links when routes are sent", async () => {
      await post({ id: 7, description: null, sectorId: 11, routes: [{ routeId: 101, label: "B" }] });

      expect(await topoRow()).toMatchObject({ name: "Topo", description: null, sector_id: 11 });
      expect(await links()).toEqual([{ route_id: 101, label: "B" }]);
    });

    it("links more routes than one D1 insert allows", async () => {
      const ids = Array.from({ length: 25 }, (_, index) => 200 + index);
      await db.insertInto("route").values(ids.map((id) => ({ id, name: `Route ${id}`, sector_id: 10 }))).execute();

      const response = await post({ id: 7, routes: ids.map((routeId) => ({ routeId })) });

      expect(response.status).toBe(200);
      expect((await links()).map((link) => link.route_id)).toEqual(ids);
    });

    it("returns 404 for an id that doesn't exist instead of creating a topo", async () => {
      const response = await post({ id: 999, name: "Ghost" }, { background: image("bg.jpg"), raster: image("raster.jpg") });

      expect(response.status).toBe(404);
      expect(await db.selectFrom("topo").select("id").execute()).toEqual([{ id: 7 }]);
      expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    });

    it.each([
      ["a new route instead of a link", { id: 7, routes: [{ name: "Brand New Line" }] }, "Propose new routes through the submissions API"],
      ["a route linked twice", { id: 7, routes: [{ routeId: 100 }, { routeId: 100 }] }, "Route 100 is linked more than once"],
      ["a route that doesn't exist", { id: 7, routes: [{ routeId: 404 }] }, "Route 404 doesn't exist"],
      ["a sector that doesn't exist", { id: 7, sectorId: 55 }, "Sector 55 doesn't exist"],
      ["an image hosted elsewhere", { id: 7, rasterUrl: "https://elsewhere.example/r.jpg" }, "rasterUrl must point to an image stored by TABVAR"],
      ["an unknown status", { id: 7, status: "Retired" }, "status must be one of Active, Deleted"],
      ["a new topo without a name", { uuid: "topo-x" }, "Topo name is required"],
    ])("rejects %s before uploading anything", async (_label, payload, message) => {
      const response = await post(payload, { raster: image("raster.jpg") });

      expect(response.status).toBe(400);
      expect((await readJson(response)).message).toContain(message);
      expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
      expect(await topoRow()).toMatchObject({ name: "Topo", sector_id: 10 });
    });

    it("rejects an image it can't measure, before uploading anything", async () => {
      const response = await post({ id: 7 }, { background: new File(["not an image"], "bg.jpg", { type: "image/jpeg" }) });

      expect(response.status).toBe(400);
      expect((await readJson(response)).message).toContain("The background image isn't a readable image");
      expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    });

    it("soft-deletes a topo, and returns 404 for one that doesn't exist", async () => {
      const deleted = await remove("uuid=topo-7");
      expect(deleted.status).toBe(200);
      expect(await readJson(deleted)).toEqual({ success: true });
      expect(await topoRow()).toMatchObject({ status: "Deleted" });

      expect((await remove("id=999")).status).toBe(404);
    });

    it("lists more topos than one D1 query allows, each with its routes", async () => {
      const ids = Array.from({ length: 95 }, (_, index) => 1000 + index);
      await db.insertInto("topo").values(ids.map((id) => ({
        id,
        uuid: `topo-${id}`,
        name: `Topo ${id}`,
        background_image_url: "https://topos.example.com/topos/raw/bg.jpg",
        raster_image_url: "https://topos.example.com/topos/raster/r.jpg",
      }))).execute();
      for (const id of ids) {
        await db.insertInto("route_topo").values({ topo_id: id, route_id: 101, label: "1", sort_order: 1 }).execute();
      }

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/v1/topos"),
        context: createContext(),
        params: {},
      })) as Response;

      const { topos } = await readJson(response);
      expect(topos).toHaveLength(96);
      expect(topos.every((topo: { routes: unknown[] }) => topo.routes.length === 1)).toBe(true);
    });

    it("returns 204 on OPTIONS preflight", async () => {
      const response = await action(createRouteArgs({
        request: new Request("https://example.com/api/v1/topos", { method: "OPTIONS" }),
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(204);
    });
  });
});
