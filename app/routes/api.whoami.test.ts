import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createGetRequest,
  createMockDb,
  createRouteArgs,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  getSessionUser: mocks.getSessionUser,
}));

import { loader } from "./api.whoami";

function loadWhoami() {
  return loader(
    createRouteArgs({
      request: createGetRequest("https://example.com/api/whoami"),
      context: createContext(),
      params: {},
    })
  );
}

describe("api.whoami loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without hitting the database when there is no session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await loadWhoami();

    expect(getStatus(response)).toBe(401);
    expect(await readJson(response)).toEqual({
      error: "unauthenticated",
      message: "No valid session.",
    });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("returns 401 when the session user no longer exists in the database", async () => {
    mocks.getSessionUser.mockResolvedValue(createUser({ uid: "deleted-user" }));
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loadWhoami();

    expect(getStatus(response)).toBe(401);
    expect(await readJson(response)).toEqual({
      error: "unauthenticated",
      message: "No valid session.",
    });
  });

  it("returns fresh role and active tag names from the database", async () => {
    // Session holds a stale snapshot; the endpoint must prefer DB values.
    mocks.getSessionUser.mockResolvedValue(
      createUser({ uid: "user-1", role: "anonymous" })
    );
    const db = createMockDb({
      select: [
        {
          executeTakeFirst: {
            uid: "user-1",
            email: "user@example.com",
            display_name: "Test User",
            role: "member",
          },
        },
        {
          execute: [
            {
              assignmentId: 1,
              tagId: 10,
              name: "Supporter",
              description: null,
              color: "teal",
              expiresAt: null,
            },
            {
              assignmentId: 2,
              tagId: 11,
              name: "ExpiredTag",
              description: null,
              color: null,
              expiresAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loadWhoami();

    expect(getStatus(response)).toBe(200);
    expect(await readJson(response)).toEqual({
      uid: "user-1",
      email: "user@example.com",
      displayName: "Test User",
      role: "member",
      tags: ["Supporter"],
    });
    expect(db.selectFrom).toHaveBeenCalledWith("user");
    expect(db.__queries[0].where).toHaveBeenCalledWith("uid", "=", "user-1");
  });
});
