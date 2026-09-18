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
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

import { action, loader } from "./users._index";

describe("users._index loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 data for non-admin users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/users"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toMatchObject({
      users: [],
      error: "You do not have the required permissions to access this page.",
    });
  });

  it("lists users and invites for admins", async () => {
    const users = [createUser({ role: "admin" })];
    const invites = [{ email: "new@example.com", role: "member" }];
    const db = createMockDb({
      select: [{ execute: users }, { execute: invites }],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/users"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      users: [{ ...users[0], tags: [] }],
      invites: [{ ...invites[0], tags: [] }],
      tags: [],
    });
    expect(db.selectFrom).toHaveBeenCalledWith("user");
    expect(db.selectFrom).toHaveBeenCalledWith("user_invite");
    expect(db.selectFrom).toHaveBeenCalledWith("user_tag");
  });

  it("populates assigned tags for users", async () => {
    const users = [createUser({ uid: "u-1", role: "member" })];
    const tags = [{ id: 10, name: "Supporter", description: "Donor", color: "teal" }];
    const assignments = [
      {
        assignmentId: 1,
        uid: "u-1",
        tagId: 10,
        name: "Supporter",
        description: "Donor",
        color: "teal",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ];
    const db = createMockDb({
      select: [
        { execute: users },
        { execute: [] },
        { execute: tags },
        { execute: assignments },
      ],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/users"),
      context: createContext(),
      params: {},
    }));

    const data = await readJson<{ users: Array<{ tags: unknown[] }> }>(response);
    expect(data.users[0].tags).toEqual([
      {
        assignmentId: 1,
        tagId: 10,
        name: "Supporter",
        description: "Donor",
        color: "teal",
        expiresAt: "2099-01-01T00:00:00.000Z",
        isExpired: false,
      },
    ]);
  });
});

describe("users._index action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(createUser({ uid: "admin-1", displayName: "Admin", role: "admin" }));
  });

  it("returns 403 for non-admin users", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", { action: "set_role" }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "You do not have the required permissions to access this page.",
    });
  });

  it("deletes a user and related sign-in events", async () => {
    const db = createMockDb({
      delete: [{ execute: undefined }, { execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "delete_user",
        uid: "user-2",
        email: "user2@example.com",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true });
    expect(db.deleteFrom).toHaveBeenCalledWith("signin_event");
    expect(db.deleteFrom).toHaveBeenCalledWith("user");
  });

  it("skips deleting the protected account", async () => {
    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "delete_user",
        uid: "protected",
        email: "dserink@gmail.com",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("sets a user role", async () => {
    const db = createMockDb({ update: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "set_role",
        uid: "user-2",
        role: "super",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true });
    expect(db.updateTable).toHaveBeenCalledWith("user");
    expect(db.__queries[0].set).toHaveBeenCalledWith({ role: "super" });
  });

  it("creates invites for one or many emails", async () => {
    const db = createMockDb({
      insert: [{ execute: undefined }, { execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "create_invite",
        invite_email: "one@example.com; two@example.com",
        invite_name: "Ignored For Many",
        invite_role: "member",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true, message: "Invite created." });
    expect(db.insertInto).toHaveBeenCalledTimes(2);
    expect(db.__queries[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "one@example.com",
        display_name: null,
        role: "member",
        invited_by_uid: "admin-1",
        invited_by_name: "Admin",
      })
    );
  });

  it("creates invites and associates invite tags", async () => {
    const db = createMockDb({
      insert: [{ execute: undefined }, { execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const formData = new FormData();
    formData.append("action", "create_invite");
    formData.append("invite_email", "supporter@example.com");
    formData.append("invite_role", "member");
    formData.append("invite_tags", "42");

    const request = new Request("https://example.com/users", {
      method: "POST",
      body: formData,
    });

    const response = await action(createRouteArgs({
      request,
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true, message: "Invite created." });
    expect(db.insertInto).toHaveBeenCalledWith("user_invite");
    expect(db.insertInto).toHaveBeenCalledWith("user_invite_tag");
  });

  it("returns a duplicate invite failure", async () => {
    const db = createMockDb({ insert: [{ execute: new Error("unique failed") }] });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "create_invite",
        invite_email: "one@example.com",
        invite_role: "member",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(500);
    expect(await readJson(response)).toEqual({
      success: false,
      message: "Could not create invite. If this email is already invited, delete it first to re-invite.",
    });
  });

  it("deletes invites and redirects for unknown actions", async () => {
    const db = createMockDb({ delete: [{ execute: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const deleteResponse = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "delete_invite",
        inviteId: "one@example.com",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(deleteResponse)).toEqual({ success: true, message: "Invite deleted." });
    expect(db.deleteFrom).toHaveBeenCalledWith("user_invite");

    const redirectResponse = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "unknown",
      }),
      context: createContext(),
      params: {},
    }));

    expect(redirectResponse).toBeInstanceOf(Response);
    expect((redirectResponse as Response).status).toBe(302);
    expect((redirectResponse as Response).headers.get("Location")).toBe("/users");
  });

  it("assigns a new tag to a user", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: undefined }],
      insert: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "assign_tag",
        uid: "user-1",
        tag_id: "5",
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      success: true,
      message: "Tag assigned successfully.",
    });
    expect(db.insertInto).toHaveBeenCalledWith("user_tag_assignment");
  });

  it("updates an existing tag assignment when re-assigned", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 42 } }],
      update: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "assign_tag",
        uid: "user-1",
        tag_id: "5",
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      success: true,
      message: "Tag assignment updated.",
    });
    expect(db.updateTable).toHaveBeenCalledWith("user_tag_assignment");
  });

  it("removes a tag assignment from a user", async () => {
    const db = createMockDb({
      delete: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "remove_tag",
        assignment_id: "42",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      success: true,
      message: "Tag removed from user.",
    });
    expect(db.deleteFrom).toHaveBeenCalledWith("user_tag_assignment");
  });

  it("updates a tag assignment expiration date", async () => {
    const db = createMockDb({
      update: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "update_tag_expiration",
        assignment_id: "42",
        expires_at: "2099-12-31T23:59:59.000Z",
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({
      success: true,
      message: "Tag expiration updated.",
    });
    expect(db.updateTable).toHaveBeenCalledWith("user_tag_assignment");
  });
});
