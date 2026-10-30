import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createRouteArgs, createContext, createGetRequest, createMockDb, readJson, getStatus } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { loader } from "./api.search";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => SqliteDatabase;

describe("api.search loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when query is missing", async () => {
    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/search"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "parameter <query> is required",
    });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it.each([
    ["empty query", "https://example.com/api/search?query="],
    ["whitespace-only query", "https://example.com/api/search?query=%20%20%20"],
    ["only unsupported characters", "https://example.com/api/search?query=!!%23"],
  ])("returns 400 for %s", async (_label, url) => {
    const response = await loader(createRouteArgs({
      request: createGetRequest(url),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "parameter <query> is required",
    });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid search mode", async () => {
    mocks.getDB.mockReturnValue(createMockDb());

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/search?query=ace&searchMode=bad"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "optional parameter <searchMode> must be one of: allObjects, routesOnly, or global (default)",
    });
  });

  it.each([
    ["global", "https://example.com/api/search?query=ace", 1],
    ["routesOnly", "https://example.com/api/search?query=ace&searchMode=routesOnly", 1],
    ["allObjects", "https://example.com/api/search?query=ace&searchMode=allObjects", 3],
  ])("returns results for %s mode", async (_mode, url, expectedSelects) => {
    const row = {
      routeId: 10,
      sectorId: 20,
      cragId: 30,
      cragSlug: "test-crag",
      type: "route",
      routeName: "Ace",
      routeAltNames: null,
      sectorName: "Main",
      cragName: "Test Crag",
      gradeYds: "5.10a",
      boltCount: "8",
      pitchCount: "1",
    };
    const db = createMockDb({
      select: [{ execute: [row] }, {}, {}],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(createRouteArgs({
      request: createGetRequest(url),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual([row]);
    expect(db.selectFrom).toHaveBeenCalledTimes(expectedSelects);

    if (_mode === "allObjects") {
      expect(db.__queries[0].limit).toHaveBeenCalledWith(10);
    }
  });

  it("strips unsupported query characters before searching", async () => {
    const db = createMockDb({ select: [{ execute: [] }] });
    mocks.getDB.mockReturnValue(db);

    await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/search?query=ace!!"),
      context: createContext(),
      params: {},
    }));

    expect(db.__queries[0].where).toHaveBeenCalledWith(expect.anything(), "match", '"ace" *');
  });

  describe("real SQLite execution", () => {
    function setupRealDb() {
      const sqlite = new Sqlite(":memory:") as any;
      sqlite.exec(`
        CREATE TABLE crag (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
        CREATE VIRTUAL TABLE route_search USING fts5(
          name,
          alt_names,
          sector_name,
          crag_name,
          sector_id UNINDEXED,
          crag_id UNINDEXED,
          grade_yds UNINDEXED,
          bolt_count UNINDEXED,
          pitch_count UNINDEXED
        );
        INSERT INTO crag (id, slug, name) VALUES (1, 'cougar-canyon', 'Cougar Canyon');
        INSERT INTO route_search (rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count)
        VALUES (101, 'Cougar Bait', NULL, 'Cougar Sector', 'Cougar Canyon', 11, 1, '5.10a', 5, 1);
      `);

      return new Kysely<DB>({
        dialect: new SqliteDialect({
          database: sqlite,
        }),
      });
    }

    it("executes allObjects search without syntax error", async () => {
      const realDb = setupRealDb();
      mocks.getDB.mockReturnValue(realDb);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/search?query=cougar&searchMode=allObjects"),
        context: createContext(),
        params: {},
      }));

      expect(getStatus(response)).toBe(200);
      const results = await readJson(response);
      expect(results).toHaveLength(3);
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "crag", cragName: "Cougar Canyon" }),
        expect.objectContaining({ type: "sector", sectorName: "Cougar Sector" }),
        expect.objectContaining({ type: "route", routeName: "Cougar Bait" }),
      ]));
    });

    it("executes routesOnly search without syntax error", async () => {
      const realDb = setupRealDb();
      mocks.getDB.mockReturnValue(realDb);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/search?query=cougar&searchMode=routesOnly"),
        context: createContext(),
        params: {},
      }));

      expect(getStatus(response)).toBe(200);
      const results = await readJson(response);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ type: "route", routeName: "Cougar Bait" });
    });

    it("executes global search without syntax error", async () => {
      const realDb = setupRealDb();
      mocks.getDB.mockReturnValue(realDb);

      const response = await loader(createRouteArgs({
        request: createGetRequest("https://example.com/api/search?query=cougar"),
        context: createContext(),
        params: {},
      }));

      expect(getStatus(response)).toBe(200);
      const results = await readJson(response);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ type: "route", routeName: "Cougar Bait" });
    });
  });
});
