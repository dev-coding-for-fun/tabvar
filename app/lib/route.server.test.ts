import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("./db", () => ({
  getDB: mocks.getDB,
}));

import { createRoute, deleteRoute, updateRoute, updateRouteOrder } from "./route.server";

describe("route.server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates createRoute required fields", async () => {
    mocks.getDB.mockReturnValue(createMockDb());

    await expect(createRoute(createContext(), { sectorId: 1 })).resolves.toEqual({
      success: false,
      error: "Missing required fields",
    });
  });

  it("creates a route", async () => {
    const db = createMockDb({ insert: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    await expect(
      createRoute(createContext(), {
        sectorId: 1,
        name: "New Route",
        gradeYds: "5.9",
        climbStyle: "Sport",
        boltCount: 8,
      })
    ).resolves.toEqual({ success: true });

    expect(db.insertInto).toHaveBeenCalledWith("route");
    expect(db.__queries[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Route",
        sector_id: 1,
        grade_yds: "5.9",
        climb_style: "Sport",
        bolt_count: 8,
      })
    );
  });

  it("returns a failure when createRoute DB write fails", async () => {
    const db = createMockDb({ insert: [{ execute: new Error("write failed") }] });
    mocks.getDB.mockReturnValue(db);

    await expect(createRoute(createContext(), { sectorId: 1, name: "Bad" })).resolves.toEqual({
      success: false,
      error: "Failed to create route",
    });
  });

  it("validates and updates a route", async () => {
    const db = createMockDb({ update: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    await expect(updateRoute(createContext(), { id: 5, name: "Updated" })).resolves.toEqual({
      success: true,
    });
    expect(db.updateTable).toHaveBeenCalledWith("route");

    await expect(updateRoute(createContext(), { id: 5 })).resolves.toEqual({
      success: false,
      error: "Missing required fields",
    });
  });

  it("updates route order", async () => {
    const db = createMockDb({
      update: [{ execute: undefined }, { execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    await expect(
      updateRouteOrder(createContext(), 2, [
        { id: 10, sortOrder: 0 },
        { id: 11, sortOrder: 1 },
      ])
    ).resolves.toEqual({ success: true });

    expect(db.updateTable).toHaveBeenCalledTimes(2);
  });

  it("deletes a route and handles missing ids", async () => {
    const db = createMockDb({ delete: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    await expect(deleteRoute(createContext(), 8)).resolves.toEqual({ success: true });
    expect(db.deleteFrom).toHaveBeenCalledWith("route");

    await expect(deleteRoute(createContext(), 0)).resolves.toEqual({
      success: false,
      error: "Missing route id",
    });
  });
});
