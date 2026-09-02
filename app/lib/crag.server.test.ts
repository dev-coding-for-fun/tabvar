import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb, type MockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("./db", () => ({
  getDB: mocks.getDB,
}));

import { loadCragBySlug } from "./crag.server";

// Sector sort order deliberately disagrees with sector id order, and issues are
// returned flagged-first rather than grouped by route, so the loader cannot rely
// on the two result sets lining up positionally.
function createCragDb() {
  return createMockDb({
    select: [
      { executeTakeFirst: { id: 1, name: "Test Crag", slug: "test-crag" } },
      { execute: [] }, // crag_attachment
      { execute: [
        { id: 5, name: "Upper", cragId: 1, sortOrder: 1 },
        { id: 2, name: "Lower", cragId: 1, sortOrder: 2 },
      ] },
      { execute: [] }, // sector_attachment
      { execute: [
        { id: 100, name: "Lower Route", sectorId: 2 },
        { id: 200, name: "Upper Route", sectorId: 5 },
      ] },
      { execute: [] }, // route_attachment
      { execute: [
        { id: 9, routeId: 200, issueType: "Bolts", status: "Reported", isFlagged: 1 },
        { id: 4, routeId: 100, issueType: "Anchor", status: "Reported", isFlagged: 0 },
      ] },
      { execute: [
        { id: 11, issueId: 9, url: "https://example.com/9.jpg", type: "image/jpeg" },
        { id: 12, issueId: 4, url: "https://example.com/4.jpg", type: "image/jpeg" },
      ] },
    ],
  });
}

function getIssueQuery(db: MockDb) {
  // Only selects run here, so selectFrom call order matches __queries order.
  const index = db.selectFrom.mock.calls.findIndex(([table]) => table === "issue");
  return db.__queries[index];
}

// The status filter is a callback, so invoke it with a stub to capture the operands.
function getStatusFilterOperands(db: MockDb) {
  const statusFilter = getIssueQuery(db).where.mock.calls[1][0] as (eb: unknown) => unknown;
  const eb = vi.fn();
  statusFilter(eb);
  return eb.mock.calls[0];
}

describe("loadCragBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes resolved and unmoderated issues", async () => {
    const db = createCragDb();
    mocks.getDB.mockReturnValue(db);

    await loadCragBySlug(createContext(), "test-crag");

    expect(getStatusFilterOperands(db)).toEqual([
      expect.anything(),
      "not in",
      ["archived", "closed", "completed", "deleted", "in moderation"],
    ]);
  });

  it("sorts flagged issues first so the card shows the most serious one", async () => {
    const db = createCragDb();
    mocks.getDB.mockReturnValue(db);

    await loadCragBySlug(createContext(), "test-crag");

    expect(getIssueQuery(db).orderBy).toHaveBeenCalledWith("is_flagged", "desc");
  });

  it("attaches each issue to its own route regardless of result ordering", async () => {
    const db = createCragDb();
    mocks.getDB.mockReturnValue(db);

    const crag = await loadCragBySlug(createContext(), "test-crag");
    const upperRoute = crag.sectors.find(sector => sector.id === 5)?.routes[0];
    const lowerRoute = crag.sectors.find(sector => sector.id === 2)?.routes[0];

    expect(upperRoute?.issues.map(issue => issue.id)).toEqual([9]);
    expect(lowerRoute?.issues.map(issue => issue.id)).toEqual([4]);
  });

  it("attaches each issue photo to its own issue", async () => {
    const db = createCragDb();
    mocks.getDB.mockReturnValue(db);

    const crag = await loadCragBySlug(createContext(), "test-crag");
    const issues = crag.sectors.flatMap(sector => sector.routes.flatMap(route => route.issues));

    expect(issues.find(issue => issue.id === 9)?.attachments?.map(a => a.id)).toEqual([11]);
    expect(issues.find(issue => issue.id === 4)?.attachments?.map(a => a.id)).toEqual([12]);
  });
});
