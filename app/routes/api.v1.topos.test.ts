// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createMockDb, createRouteArgs } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireApiTokenUser: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/apiAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apiAuth.server")>()),
  requireApiTokenUser: mocks.requireApiTokenUser,
}));

import { loader as cragsLoader } from "./api.v1.crags";
import { loader as routesLoader } from "./api.v1.routes";
import { loader as sectorsLoader } from "./api.v1.sectors";

type CragsResponse = { crags: unknown[]; serverTime: string };
type SectorsResponse = { sectors: unknown[] };
type RoutesResponse = { routes: unknown[] };

function tokenUser(overrides: Record<string, unknown> = {}) {
  return { tokenId: "t1", uid: "u1", client: "topobuilder", role: "member", displayName: "Mod", ...overrides };
}

describe("api.v1 topo catalog loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser());
  });

  it("returns crags with an attachment placeholder", async () => {
    const db = createMockDb({
      select: [{
        execute: [{
          id: 7,
          name: "Sunny Crag",
          slug: "sunny-crag",
          latitude: 51.1,
          longitude: -115.1,
          notes: "South-facing",
          stats_active_issue_count: 2,
          stats_issue_flagged: 1,
          stats_public_issue_count: 3,
          created_at: "2026-06-01 00:00:00",
          updated_at: "2026-06-09 10:00:00",
        }],
      }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await cragsLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/crags"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as CragsResponse;
    expect(body.crags).toEqual([{
      id: 7,
      name: "Sunny Crag",
      slug: "sunny-crag",
      latitude: 51.1,
      longitude: -115.1,
      notes: "South-facing",
      statsActiveIssueCount: 2,
      statsIssueFlagged: 1,
      statsPublicIssueCount: 3,
      createdAt: "2026-06-01 00:00:00",
      updatedAt: "2026-06-09 10:00:00",
      attachments: [],
    }]);
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(db.__queries[0].orderBy).toHaveBeenCalledWith("name", "asc");
  });

  it("applies the since cursor to crag deltas and advances serverTime", async () => {
    const db = createMockDb({
      select: [{
        execute: [{
          id: 7,
          name: "Sunny Crag",
          slug: "sunny-crag",
          latitude: 51.1,
          longitude: -115.1,
          notes: "South-facing",
          stats_active_issue_count: 2,
          stats_issue_flagged: 1,
          stats_public_issue_count: 3,
          created_at: "2026-06-01 00:00:00",
          updated_at: "2026-06-09 11:00:00",
        }],
      }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await cragsLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/crags?since=2026-06-09%2010:00:00"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as CragsResponse;
    expect(body.serverTime).toBe("2026-06-09 11:00:00");
    expect(db.__queries[0].where).toHaveBeenCalledWith("crag.updated_at", ">=", "2026-06-09 10:00:00");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(1, "crag.updated_at", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(2, "crag.id", "asc");
  });

  it("returns sectors ordered for crag-local sync", async () => {
    const db = createMockDb({
      select: [{
        execute: [{
          id: 5,
          crag_id: 7,
          name: "Main Wall",
          latitude: null,
          longitude: null,
          notes: null,
          sort_order: 10,
          created_at: null,
          updated_at: "2026-06-09 10:00:00",
        }],
      }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await sectorsLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/sectors"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as SectorsResponse;
    expect(body.sectors).toMatchObject([{ id: 5, cragId: 7, name: "Main Wall", sortOrder: 10, attachments: [] }]);
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(1, "crag_id", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(2, "sort_order", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(3, "name", "asc");
  });

  it("applies the since cursor to sector deltas", async () => {
    const db = createMockDb({ select: [{ execute: [] }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await sectorsLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/sectors?since=2026-06-09%2010:00:00"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as { serverTime: string };
    expect(body.serverTime).toBe("2026-06-09 10:00:00");
    expect(db.__queries[0].where).toHaveBeenCalledWith("sector.updated_at", ">=", "2026-06-09 10:00:00");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(1, "sector.updated_at", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(2, "sector.id", "asc");
  });

  it("returns routes with foreign keys and display fields", async () => {
    const db = createMockDb({
      select: [{
        execute: [{
          id: 100,
          crag_id: 7,
          sector_id: 5,
          name: "Solar Flare",
          alt_names: null,
          grade_yds: "5.11a",
          status: "active",
          latitude: null,
          longitude: null,
          notes: "Classic",
          sort_order: 20,
          bolt_count: 9,
          pitch_count: 2,
          route_length: 35,
          climb_style: "sport",
          year: 2020,
          route_built_date: null,
          first_ascent_by: "A. Climber",
          first_ascent_date: null,
          crag_name: "Sunny Crag",
          sector_name: "Main Wall",
          created_at: "2026-06-01 00:00:00",
          updated_at: "2026-06-09 10:00:00",
        }],
      }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await routesLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/routes"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as RoutesResponse;
    expect(body.routes).toMatchObject([{
      id: 100,
      cragId: 7,
      sectorId: 5,
      name: "Solar Flare",
      gradeYds: "5.11a",
      cragName: "Sunny Crag",
      sectorName: "Main Wall",
      attachments: [],
    }]);
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(1, "crag_id", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(2, "sector_id", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(3, "sort_order", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(4, "name", "asc");
  });

  it("applies the since cursor to route deltas", async () => {
    const db = createMockDb({ select: [{ execute: [] }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await routesLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/routes?since=2026-06-09%2010:00:00"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as { serverTime: string };
    expect(body.serverTime).toBe("2026-06-09 10:00:00");
    expect(db.__queries[0].where).toHaveBeenCalledWith("route.updated_at", ">=", "2026-06-09 10:00:00");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(1, "route.updated_at", "asc");
    expect(db.__queries[0].orderBy).toHaveBeenNthCalledWith(2, "route.id", "asc");
  });

  it("rejects catalog pulls when the token is invalid", async () => {
    mocks.requireApiTokenUser.mockRejectedValue(new Response(null, { status: 401 }));

    const response = (await cragsLoader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/crags"),
      context: createContext(),
      params: {},
    })).catch((error) => error)) as Response;

    expect(response.status).toBe(401);
  });
});
