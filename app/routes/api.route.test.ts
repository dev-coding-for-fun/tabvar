import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createFormRequest, createMockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { action } from "./api.route";

describe("api.route action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when routeId is missing", async () => {
    const response = await action({
      request: createFormRequest("https://example.com/api/route", {}),
      context: createContext(),
      params: {},
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    await expect((response as Response).json()).resolves.toEqual({
      error: "routeId is required",
    });
  });

  it("returns an empty array when the route is not found", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = await action({
      request: createFormRequest("https://example.com/api/route", { routeId: "123" }),
      context: createContext(),
      params: {},
    });

    expect((response as Response).status).toBe(200);
    await expect((response as Response).json()).resolves.toEqual([]);
  });

  it("normalizes a route row into search result shape", async () => {
    const db = createMockDb({
      select: [
        {
          executeTakeFirst: {
            routeId: 123,
            sectorId: 5,
            cragId: 9,
            cragSlug: "sunny-crag",
            routeName: "Solar Flare",
            routeAltNames: null,
            sectorName: "Main Wall",
            cragName: "Sunny Crag",
            gradeYds: "5.11a",
            boltCount: 9,
            pitchCount: 2,
          },
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action({
      request: createFormRequest("https://example.com/api/route", { routeId: "123" }),
      context: createContext(),
      params: {},
    });

    expect((response as Response).status).toBe(200);
    await expect((response as Response).json()).resolves.toEqual([
      {
        routeId: 123,
        sectorId: 5,
        cragId: 9,
        cragSlug: "sunny-crag",
        type: "route",
        routeName: "Solar Flare",
        routeAltNames: null,
        sectorName: "Main Wall",
        cragName: "Sunny Crag",
        gradeYds: "5.11a",
        boltCount: "9",
        pitchCount: "2",
      },
    ]);
  });
});
