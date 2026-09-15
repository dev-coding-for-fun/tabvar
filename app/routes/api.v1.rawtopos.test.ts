// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createRouteArgs,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireApiTokenUser: vi.fn(),
  uploadFileToR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
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

  describe("action (POST)", () => {
    it("returns 204 on OPTIONS preflight", async () => {
      const response = await action(createRouteArgs({
        request: new Request("https://example.com/api/v1/topos", { method: "OPTIONS" }),
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(204);
    });

    it("rejects anonymous users with 403", async () => {
      mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: "anonymous" }));

      const response = await action(createRouteArgs({
        request: new Request("https://example.com/api/v1/topos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Topo" }),
        }),
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(403);
      const body = await readJson(response);
      expect(body.error).toBe("forbidden");
    });

    it("uploads multipart background and raster images and persists topo with routes", async () => {
      const bgFile = new File(["clean-pixels"], "bg.jpg", { type: "image/jpeg" });
      const rasterFile = new File(["raster-pixels"], "raster.jpg", { type: "image/jpeg" });
      const payload = {
        uuid: "topo-uuid-new",
        name: "Upper Crag Topo",
        description: "New area",
        cragId: 5,
        sectorId: 12,
        width: 1920,
        height: 1080,
        annotations: {
          version: 1,
          items: [{ id: "line-1", kind: "climbLine", points: [{ x: 0.2, y: 0.8 }] }],
        },
        routes: [
          { routeId: 201, label: "A", sortOrder: 1 },
          { routeId: 202, label: "B", sortOrder: 2 },
        ],
      };

      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined }, // check existing
          { executeTakeFirst: { // loadTopoById after save
            id: 10,
            uuid: "topo-uuid-new",
            crag_id: 5,
            sector_id: 12,
            name: "Upper Crag Topo",
            description: "New area",
            background_image_url: "https://files.tabvar.org/topos/raw/rawhash123.jpg",
            background_image_hash: "rawhash123",
            raster_image_url: "https://files.tabvar.org/topos/raster/rasterhash456.jpg",
            raster_image_hash: "rasterhash456",
            image_width: 1920,
            image_height: 1080,
            image_file_size: 1024,
            annotations_json: JSON.stringify(payload.annotations),
            status: "Active",
            created_at: "2026-09-12 12:00:00",
            updated_at: "2026-09-12 12:00:00",
          } },
          { execute: [ // loadTopoById routes
            { topoId: 10, routeId: 201, label: "A", sortOrder: 1, routeName: "Route A", createdAt: "2026-09-12 12:00:00" },
            { topoId: 10, routeId: 202, label: "B", sortOrder: 2, routeName: "Route B", createdAt: "2026-09-12 12:00:00" },
          ] },
        ],
        insert: [
          { executeTakeFirst: { insertId: 10n } }, // insert topo
          { execute: [] }, // insert route_topo
        ],
        delete: [
          { execute: [] }, // delete old route_topo
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const request = createFormRequest("https://example.com/api/v1/topos", {
        background: bgFile,
        raster: rasterFile,
        payload: JSON.stringify(payload),
      });

      const response = await action(createRouteArgs({
        request,
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.topo).toMatchObject({
        id: 10,
        uuid: "topo-uuid-new",
        name: "Upper Crag Topo",
        backgroundImageUrl: "https://files.tabvar.org/topos/raw/rawhash123.jpg",
        rasterImageUrl: "https://files.tabvar.org/topos/raster/rasterhash456.jpg",
        routes: [
          { routeId: 201, label: "A" },
          { routeId: 202, label: "B" },
        ],
      });
      expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(2);
      expect(db.insertInto).toHaveBeenCalledWith("topo");
      expect(db.insertInto).toHaveBeenCalledWith("route_topo");
    });

    it("creates new routes on the fly alongside existing routes and maps both to the topo", async () => {
      const bgFile = new File(["clean"], "bg.jpg", { type: "image/jpeg" });
      const rasterFile = new File(["raster"], "raster.jpg", { type: "image/jpeg" });
      const payload = {
        uuid: "topo-mixed-routes",
        name: "Mixed Wall Topo",
        sectorId: 12,
        routes: [
          { routeId: 101, label: "1", sortOrder: 1 },
          { name: "Brand New Line", gradeYds: "5.11b", climbStyle: "Sport", boltCount: 7, label: "2", sortOrder: 2 },
        ],
      };

      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined }, // check existing topo
          { executeTakeFirst: { // loadTopoById after save
            id: 20,
            uuid: "topo-mixed-routes",
            sector_id: 12,
            name: "Mixed Wall Topo",
            background_image_url: "https://files.tabvar.org/topos/raw/rawhash123.jpg",
            raster_image_url: "https://files.tabvar.org/topos/raster/rasterhash456.jpg",
            status: "Active",
            annotations_json: "{}",
            created_at: "2026-09-12 12:00:00",
            updated_at: "2026-09-12 12:00:00",
          } },
          { execute: [ // loadTopoById routes
            { topoId: 20, routeId: 101, label: "1", sortOrder: 1, routeName: "Existing Route", createdAt: "2026-09-12 12:00:00" },
            { topoId: 20, routeId: 999, label: "2", sortOrder: 2, routeName: "Brand New Line", createdAt: "2026-09-12 12:00:00" },
          ] },
        ],
        insert: [
          { executeTakeFirst: { insertId: 20n } }, // insert topo
          { executeTakeFirst: { insertId: 999n } }, // insert new route
          { execute: [] }, // insert route_topo
        ],
        delete: [
          { execute: [] }, // delete old route_topo
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const request = createFormRequest("https://example.com/api/v1/topos", {
        background: bgFile,
        raster: rasterFile,
        payload: JSON.stringify(payload),
      });

      const response = await action(createRouteArgs({
        request,
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.topo.routes).toEqual([
        expect.objectContaining({ routeId: 101, label: "1", routeName: "Existing Route" }),
        expect.objectContaining({ routeId: 999, label: "2", routeName: "Brand New Line" }),
      ]);
      expect(db.insertInto).toHaveBeenCalledWith("route");
      expect(db.insertInto).toHaveBeenCalledWith("route_topo");
    });

    it("rejects new route creation when sectorId is missing from both route and topo", async () => {
      const bgFile = new File(["clean"], "bg.jpg", { type: "image/jpeg" });
      const rasterFile = new File(["raster"], "raster.jpg", { type: "image/jpeg" });
      const payload = {
        name: "No Sector Topo",
        routes: [
          { name: "Orphan Route", label: "1" },
        ],
      };

      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined },
        ],
        insert: [
          { executeTakeFirst: { insertId: 1n } },
        ],
        delete: [
          { execute: [] },
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const request = createFormRequest("https://example.com/api/v1/topos", {
        background: bgFile,
        raster: rasterFile,
        payload: JSON.stringify(payload),
      });

      const response = await action(createRouteArgs({
        request,
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.message).toContain("without a sectorId");
    });

    it("stores and returns GPS coordinates (latitude and longitude) for a topo", async () => {
      const bgFile = new File(["clean"], "bg.jpg", { type: "image/jpeg" });
      const rasterFile = new File(["raster"], "raster.jpg", { type: "image/jpeg" });
      const payload = {
        uuid: "topo-gps-1",
        name: "GPS Tagged Wall",
        lat: 51.0543,
        lon: -115.3421,
      };

      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined },
          { executeTakeFirst: {
            id: 15,
            uuid: "topo-gps-1",
            name: "GPS Tagged Wall",
            latitude: 51.0543,
            longitude: -115.3421,
            background_image_url: "https://files.tabvar.org/topos/raw/bg.jpg",
            raster_image_url: "https://files.tabvar.org/topos/raster/raster.jpg",
            status: "Active",
            annotations_json: "{}",
            created_at: "2026-09-12 12:00:00",
            updated_at: "2026-09-12 12:00:00",
          } },
          { execute: [] },
        ],
        insert: [
          { executeTakeFirst: { insertId: 15n } },
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const request = createFormRequest("https://example.com/api/v1/topos", {
        background: bgFile,
        raster: rasterFile,
        payload: JSON.stringify(payload),
      });

      const response = await action(createRouteArgs({
        request,
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.topo.latitude).toBeCloseTo(51.0543);
      expect(body.topo.longitude).toBeCloseTo(-115.3421);
      expect(db.insertInto).toHaveBeenCalledWith("topo");
    });

    it("supports soft deletion via DELETE method", async () => {
      const db = createMockDb({
        update: [{ executeTakeFirst: { numUpdatedRows: 1n } }],
      });
      mocks.getDB.mockReturnValue(db);

      const response = await action(createRouteArgs({
        request: new Request("https://example.com/api/v1/topos?id=topo-to-delete", {
          method: "DELETE",
        }),
        context: createContext(),
        params: {},
      }));

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(db.updateTable).toHaveBeenCalledWith("topo");
    });
  });
});
