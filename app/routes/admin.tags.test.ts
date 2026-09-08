import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createRouteArgs,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  getAllTags: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/tags.server", () => ({
  getAllTags: mocks.getAllTags,
}));

import { action, loader } from "./admin.tags";

describe("admin.tags loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 data for non-admin users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await loader(
      createRouteArgs({
        request: createGetRequest("https://example.com/admin/tags"),
        context: createContext(),
        params: {},
      })
    );

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toMatchObject({
      tags: [],
      error: "You do not have the required permissions to access this page.",
    });
  });

  it("lists tags for admin users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    const mockTags = [
      {
        id: 1,
        name: "Supporter",
        description: "Donor tier 1",
        color: "teal",
        createdAt: "2026-09-08",
        updatedAt: "2026-09-08",
        activeCount: 3,
      },
    ];
    mocks.getAllTags.mockResolvedValue(mockTags);

    const response = await loader(
      createRouteArgs({
        request: createGetRequest("https://example.com/admin/tags"),
        context: createContext(),
        params: {},
      })
    );

    expect(await readJson(response)).toEqual({ tags: mockTags });
  });
});

describe("admin.tags action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(
      createUser({ uid: "admin-1", displayName: "Admin", role: "admin" })
    );
  });

  it("returns 403 for non-admin users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "create_tag",
          name: "Supporter",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "You do not have the required permissions to access this page.",
    });
  });

  it("creates a tag successfully", async () => {
    const db = createMockDb({
      insert: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "create_tag",
          name: "Super Supporter",
          description: "Tier 2 donor",
          color: "violet",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(await readJson(response)).toEqual({
      success: true,
      message: 'Tag "Super Supporter" created successfully.',
    });
    expect(db.insertInto).toHaveBeenCalledWith("user_tag");
  });

  it("rejects creating a tag without a name", async () => {
    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "create_tag",
          name: "   ",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({
      success: false,
      message: "Tag name is required.",
    });
  });

  it("handles duplicate tag name on create", async () => {
    const db = createMockDb({
      insert: [
        {
          execute: new Error("UNIQUE constraint failed: user_tag.name"),
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "create_tag",
          name: "Supporter",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toEqual({
      success: false,
      message: 'A tag with name "Supporter" already exists.',
    });
  });

  it("updates an existing tag", async () => {
    const db = createMockDb({
      update: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "update_tag",
          tag_id: "1",
          name: "Supporter Plus",
          description: "Updated description",
          color: "teal",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(await readJson(response)).toEqual({
      success: true,
      message: 'Tag "Supporter Plus" updated successfully.',
    });
    expect(db.updateTable).toHaveBeenCalledWith("user_tag");
  });

  it("deletes a tag", async () => {
    const db = createMockDb({
      delete: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(
      createRouteArgs({
        request: createFormRequest("https://example.com/admin/tags", {
          action: "delete_tag",
          tag_id: "2",
        }),
        context: createContext(),
        params: {},
      })
    );

    expect(await readJson(response)).toEqual({
      success: true,
      message: "Tag deleted successfully.",
    });
    expect(db.deleteFrom).toHaveBeenCalledWith("user_tag");
  });
});
