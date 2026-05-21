import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createUser,
  getStatus,
  readJson,
  createRouteArgs,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  uploadFileToR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/s3.server", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
}));

import { action, loader } from "./issues.create";

describe("issues.create loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(createUser());
  });

  it("returns null initialRoute when no routeId is supplied", async () => {
    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/issues/create"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ initialRoute: null });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("returns null initialRoute when the route is not found", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/issues/create?routeId=100"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ initialRoute: null });
  });

  it("normalizes an initial route when routeId is found", async () => {
    const db = createMockDb({
      select: [
        {
          executeTakeFirst: {
            routeId: 100,
            sectorId: 20,
            cragId: 30,
            cragSlug: "test-crag",
            routeName: "Test Route",
            routeAltNames: "Alt",
            sectorName: "Main",
            cragName: "Test Crag",
            gradeYds: "5.10b",
            boltCount: 7,
            pitchCount: 1,
          },
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/issues/create?routeId=100"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      initialRoute: {
        routeId: 100,
        sectorId: 20,
        cragId: 30,
        cragSlug: "test-crag",
        routeName: "Test Route",
        routeAltNames: "Alt",
        type: "route",
        sectorName: "Main",
        cragName: "Test Crag",
        gradeYds: "5.10b",
        boltCount: "7",
        pitchCount: "1",
      },
    });
  });
});

describe("issues.create action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(createUser({ uid: "reporter-1", displayName: "Reporter" }));
  });

  it("rejects missing route selection", async () => {
    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/create", {
        issueType: "Bolts",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      message: "Route selection is required",
    });
  });

  it("rejects invalid issue type", async () => {
    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/create", {
        route: "route:100",
        issueType: "Bad Type",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      message: "Issue type missing, please select one",
    });
  });

  it("creates an issue and redirects on success", async () => {
    const db = createMockDb({
      insert: [{ executeTakeFirstOrThrow: { id: 55 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/create", {
        route: "route:100",
        issueType: "Bolts",
        subIssueType: "Loose bolt",
        notes: "Spinner on bolt 2",
        boltNumbers: "2",
      }),
      context: createContext(),
      params: {},
    }));

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe("/issues/?success=true");
    expect(db.insertInto).toHaveBeenCalledWith("issue");
    expect(db.__queries[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        route_id: 100,
        issue_type: "Bolts",
        sub_issue_type: "Loose bolt",
        description: "Spinner on bolt 2",
        bolts_affected: "2",
        status: "In Moderation",
        reported_by_uid: "reporter-1",
      })
    );
  });

  it("uploads photos and inserts issue attachments", async () => {
    const file = new File(["photo"], "bolt.jpg", { type: "image/jpeg" });
    const db = createMockDb({
      insert: [
        { executeTakeFirstOrThrow: { id: 55 } },
        { execute: undefined },
      ],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.uploadFileToR2.mockResolvedValue({
      name: "bolt.jpg",
      type: "image/jpeg",
      url: "https://issues.example.com/bolt.jpg",
    });

    await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/create", {
        route: "route:100",
        issueType: "Bolts",
        photos: file,
      }),
      context: createContext(),
      params: {},
    }));

    expect(mocks.uploadFileToR2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "bolt.jpg" }),
      "issues",
      "https://issues.example.com"
    );
    expect(db.insertInto).toHaveBeenCalledWith("issue_attachment");
    expect(db.__queries[1].values).toHaveBeenCalledWith({
      issue_id: 55,
      name: "bolt.jpg",
      type: "image/jpeg",
      url: "https://issues.example.com/bolt.jpg",
    });
  });
});
