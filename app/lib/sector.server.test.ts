import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("./db", () => ({
  getDB: mocks.getDB,
}));

import { createSector, deleteSector, updateSectorName, updateSectorNotes } from "./sector.server";

describe("sector.server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a sector with top sort order sentinel", async () => {
    const db = createMockDb({
      insert: [{ execute: [{ id: 12, name: "New Sector" }] }],
    });
    mocks.getDB.mockReturnValue(db);

    await expect(createSector(createContext(), 3, "New Sector")).resolves.toEqual({
      success: true,
      sector: {
        id: 12,
        name: "New Sector",
        sort_order: -1,
      },
    });
    expect(db.insertInto).toHaveBeenCalledWith("sector");
  });

  it("returns a failure when createSector throws", async () => {
    const db = createMockDb({ insert: [{ execute: new Error("failed") }] });
    mocks.getDB.mockReturnValue(db);

    await expect(createSector(createContext(), 3)).resolves.toEqual({
      success: false,
      error: "Failed to create sector",
    });
  });

  it("updates sector name", async () => {
    const db = createMockDb({ update: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    await expect(updateSectorName(createContext(), 4, "Renamed")).resolves.toEqual({
      success: true,
    });
    expect(db.updateTable).toHaveBeenCalledWith("sector");
    expect(db.__queries[0].set).toHaveBeenCalledWith({ name: "Renamed" });
  });

  it("validates and updates sector notes", async () => {
    const db = createMockDb({ update: [{ executeTakeFirstOrThrow: undefined }] });
    mocks.getDB.mockReturnValue(db);

    await expect(updateSectorNotes(createContext(), 0, "Notes")).resolves.toEqual({
      success: false,
      error: "Sector ID is required",
    });

    await expect(updateSectorNotes(createContext(), 5, "Notes")).resolves.toEqual({
      success: true,
    });
  });

  it("prevents deleting sectors with routes", async () => {
    const db = createMockDb({ select: [{ execute: [{ id: 1 }] }] });
    mocks.getDB.mockReturnValue(db);

    await expect(deleteSector(createContext(), 4)).resolves.toEqual({
      success: false,
      error: "Cannot delete sector with routes",
    });
  });

  it("deletes an empty sector and validates ids", async () => {
    const db = createMockDb({
      select: [{ execute: [] }],
      delete: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    await expect(deleteSector(createContext(), 0)).resolves.toEqual({
      success: false,
      error: "Missing sector id",
    });

    await expect(deleteSector(createContext(), 4)).resolves.toEqual({ success: true });
    expect(db.deleteFrom).toHaveBeenCalledWith("sector");
  });
});
