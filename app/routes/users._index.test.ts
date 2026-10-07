import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
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

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

describe("user deletion with SQLite foreign keys", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "0002_initial_setup.sql", "0028_add_issue_audit_log.sql",
      "0053_add_goldencrowbar.sql", "0056_add_topobuilder_auth.sql",
      "0057_add_topo_submission.sql", "0061_add_user_tags.sql", "0062_add_raw_topos.sql",
    ]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      ALTER TABLE issue ADD COLUMN claimed_by_uid TEXT REFERENCES user(uid);
      INSERT INTO user (uid, email) VALUES ('target', 'target@example.com'), ('other', 'other@example.com');
      INSERT INTO route (id, name) VALUES (1, 'Test route');
      INSERT INTO issue (id, route_id, issue_type, status, reported_by_uid, approved_by_uid, archived_by_uid, claimed_by_uid)
        VALUES (1, 1, 'Other', 'Reported', 'target', 'other', 'target', 'target'),
               (2, 1, 'Other', 'Reported', 'other', 'target', 'other', 'other');
      INSERT INTO issue_audit_log (action, uid, user_display_name, issue_id) VALUES ('Create', 'target', 'Former User', 1);
      INSERT INTO signin_event (uid) VALUES ('target'), ('other');
      INSERT INTO api_token (id, uid, client, token_hash) VALUES ('target-token', 'target', 'test', 'hash1'), ('other-token', 'other', 'test', 'hash2');
      INSERT INTO topobuilder_connect_ticket (id, uid, ticket_hash, return_to, expires_at)
        VALUES ('target-ticket', 'target', 'ticket1', 'https://example.com', '2099-01-01'),
               ('other-ticket', 'other', 'ticket2', 'https://example.com', '2099-01-01');
      INSERT INTO campaign (id, name, end_date) VALUES (1, 'Test campaign', '2099-01-01');
      INSERT INTO campaign_candidate (id, campaign_id, name) VALUES (1, 1, 'Test candidate');
      INSERT INTO vote (campaign_id, uid, campaign_candidate_id) VALUES (1, 'target', 1), (1, 'other', 1);
      INSERT INTO topo_submission (id, uid, client, kind, payload, reviewed_by_uid)
        VALUES ('owned', 'target', 'test', 'topo', '{}', 'other'),
               ('reviewed', 'other', 'test', 'topo', '{}', 'target'),
               ('unrelated', 'other', 'test', 'topo', '{}', 'other');
      INSERT INTO topo (uuid, name, background_image_url, raster_image_url) VALUES ('published', 'Published topo', 'bg.png', 'topo.png');
      INSERT INTO user_tag (id, name) VALUES (1, 'Test tag');
      INSERT INTO user_tag_assignment (uid, tag_id, assigned_by_uid) VALUES ('target', 1, 'other'), ('other', 1, 'target');
    `);
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(createUser({ uid: "admin-1", role: "admin" }));
  });

  afterEach(async () => {
    await db.destroy();
  });

  const deleteTarget = () => action(createRouteArgs({
    request: createFormRequest("https://example.com/users", { action: "delete_user", uid: "target", email: "target@example.com" }),
    context: createContext(),
    params: {},
  }));

  it("removes the account without foreign key errors and preserves other users and shared history", async () => {
    // The original handler fails here even after removing sign-in events.
    await db.deleteFrom("signin_event").where("uid", "=", "target").execute();
    await expect(db.deleteFrom("user").where("uid", "=", "target").execute()).rejects.toThrow("FOREIGN KEY");
    await db.insertInto("signin_event").values({ uid: "target" }).execute();

    expect(await readJson(await deleteTarget())).toEqual({ success: true });
    expect(await db.selectFrom("user").select("uid").execute()).toEqual([{ uid: "other" }]);
    for (const table of ["signin_event", "api_token", "topobuilder_connect_ticket", "vote"] as const) {
      expect(await db.selectFrom(table).select("uid").execute()).toEqual([{ uid: "other" }]);
    }
    expect(await db.selectFrom("issue").select(["id", "reported_by_uid", "approved_by_uid", "archived_by_uid", "claimed_by_uid"]).orderBy("id").execute()).toEqual([
      { id: 1, reported_by_uid: null, approved_by_uid: "other", archived_by_uid: null, claimed_by_uid: null },
      { id: 2, reported_by_uid: "other", approved_by_uid: null, archived_by_uid: "other", claimed_by_uid: "other" },
    ]);
    expect(await db.selectFrom("topo_submission").select(["id", "uid", "reviewed_by_uid"]).orderBy("id").execute()).toEqual([
      { id: "reviewed", uid: "other", reviewed_by_uid: null },
      { id: "unrelated", uid: "other", reviewed_by_uid: "other" },
    ]);
    expect(await db.selectFrom("topo").select("uuid").execute()).toEqual([{ uuid: "published" }]);
    expect(await db.selectFrom("issue_audit_log").select(["uid", "user_display_name"]).execute()).toEqual([{ uid: "target", user_display_name: "Former User" }]);
    expect(await db.selectFrom("user_tag_assignment").select(["uid", "assigned_by_uid"]).execute()).toEqual([{ uid: "other", assigned_by_uid: null }]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all([])).toEqual([]);
  });

  it("rolls back all changes when the final deletion fails", async () => {
    sqlite.exec(`CREATE TRIGGER prevent_user_delete BEFORE DELETE ON user
      BEGIN SELECT RAISE(ABORT, 'Deletion blocked'); END;`);

    await expect(deleteTarget()).rejects.toThrow("Deletion blocked");

    expect(await db.selectFrom("user").select("uid").where("uid", "=", "target").executeTakeFirst()).toEqual({ uid: "target" });
    for (const table of ["signin_event", "api_token", "topobuilder_connect_ticket", "vote", "topo_submission"] as const) {
      expect(await db.selectFrom(table).select("uid").where("uid", "=", "target").execute()).toEqual([{ uid: "target" }]);
    }
    expect(await db.selectFrom("issue").select(["reported_by_uid", "claimed_by_uid"]).where("id", "=", 1).executeTakeFirst()).toEqual({ reported_by_uid: "target", claimed_by_uid: "target" });
    expect(await db.selectFrom("topo_submission").select("reviewed_by_uid").where("id", "=", "reviewed").executeTakeFirst()).toEqual({ reviewed_by_uid: "target" });
  });
});

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

  it("deletes a user and account-owned records in a transaction", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { email: "user2@example.com" } }],
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
    expect(db.deleteFrom).toHaveBeenCalledWith("api_token");
    expect(db.deleteFrom).toHaveBeenCalledWith("topobuilder_connect_ticket");
    expect(db.deleteFrom).toHaveBeenCalledWith("vote");
    expect(db.deleteFrom).toHaveBeenCalledWith("topo_submission");
    expect(db.deleteFrom).toHaveBeenCalledWith("user");
    expect(db.transaction).toHaveBeenCalledOnce();
    for (const query of db.__queries) {
      expect(query.where).toHaveBeenCalledWith(expect.any(String), "=", "user-2");
    }
  });

  it.each([undefined, "someone@example.com"])("protects the stored account even when the posted email is %s", async (email) => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { email: "dserink@gmail.com" } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", {
        action: "delete_user",
        uid: "protected",
        ...(email ? { email } : {}),
      }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.deleteFrom).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it("does not modify related records for a nonexistent account", async () => {
    const db = createMockDb();
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/users", { action: "delete_user", uid: "missing" }),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual({ success: true });
    expect(db.transaction).not.toHaveBeenCalled();
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
