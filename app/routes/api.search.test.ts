import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteArgs, createContext, createGetRequest, createMockDb, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { loader } from "./api.search";

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

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    await expect((response as Response).json()).resolves.toEqual({
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

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    await expect((response as Response).json()).resolves.toEqual({
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
});
