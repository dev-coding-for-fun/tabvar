import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createMockDb, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { loader } from "./api.issues";

describe("api.issues loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 400 when cragid is missing", async () => {
    await expect(
      loader({
        request: createGetRequest("https://example.com/api/issues"),
        context: createContext(),
        params: {},
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns issue rows for a crag", async () => {
    const issues = [
      {
        id: 1,
        routeId: 10,
        routeName: "Test Route",
        sectorName: "Main",
        cragName: "Test Crag",
        issueType: "Bolts",
        subIssueType: "Loose bolt",
        description: "Spinner",
        isFlagged: false,
        flaggedMessage: null,
        status: "Reported",
      },
    ];
    const db = createMockDb({ select: [{ execute: issues }] });
    mocks.getDB.mockReturnValue(db);

    const response = await loader({
      request: createGetRequest("https://example.com/api/issues?cragid=7"),
      context: createContext(),
      params: {},
    });

    expect(await readJson(response)).toEqual(issues);
    expect(db.selectFrom).toHaveBeenCalledWith("issue");
    expect(db.__queries[0].where).toHaveBeenCalledWith("crag.id", "=", 7);
  });
});
