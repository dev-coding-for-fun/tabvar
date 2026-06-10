// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb, createRouteArgs } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireApiTokenUser: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/apiAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apiAuth.server")>()),
  requireApiTokenUser: mocks.requireApiTokenUser,
}));

import { action } from "./api.v1.issues.sync";

function tokenUser(overrides: Record<string, unknown> = {}) {
  return { tokenId: "t1", uid: "u1", client: "topobuilder", role: "member", displayName: "Mod", ...overrides };
}

function fullIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    route_id: 100,
    crag_id: 7,
    issue_type: "Bolts",
    sub_issue_type: "Rusted",
    status: "Reported",
    last_status: null,
    description: "rusty",
    bolts_affected: "2",
    is_flagged: 0,
    flagged_message: null,
    reported_by: "Reporter",
    reported_by_uid: "rep-1",
    created_at: "2026-06-01 00:00:00",
    updated_at: "2026-06-09 10:00:00",
    last_modified: "2026-06-09T10:00:00.000Z",
    approved_at: null,
    archived_at: null,
    ...overrides,
  };
}

function jsonRequest(body: unknown) {
  return new Request("https://example.com/api/v1/issues/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("api.v1.issues.sync action (push)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser());
  });

  it("lets an anonymous user create an issue forced to In Moderation", async () => {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: null }));
    const db = createMockDb({
      insert: [{ executeTakeFirstOrThrow: { id: 55 } }],
      select: [{ executeTakeFirst: fullIssueRow({ id: 55, status: "In Moderation" }) }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "create", fields: { routeId: 100, issueType: "Bolts", status: "Reported" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    // status "Reported" was requested but the anonymous user is downgraded.
    expect(response.status).toBe(403);
  });

  it("creates an In Moderation issue for an anonymous user without a requested status", async () => {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: null }));
    const db = createMockDb({
      insert: [{ executeTakeFirstOrThrow: { id: 55 } }],
      select: [{ executeTakeFirst: fullIssueRow({ id: 55, status: "In Moderation" }) }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "create", fields: { routeId: 100, issueType: "Bolts" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ status: "applied", serverId: 55 });
    expect(db.__queries[0].values).toHaveBeenCalledWith(
      expect.objectContaining({ status: "In Moderation", route_id: 100, reported_by_uid: "u1" }),
    );
  });

  it("rejects status changes from anonymous users", async () => {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: null }));

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "status", issueId: 1, baseUpdatedAt: "2026-06-09 10:00:00", fields: { status: "Completed" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(403);
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("is idempotent for creates with a known externalId", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: { local_id: 77 } },
        { executeTakeFirst: fullIssueRow({ id: 77 }) },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "create", externalId: "ext-1", fields: { routeId: 100, issueType: "Bolts" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "applied", serverId: 77 });
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it("returns 409 when the server row is newer than the client base (server wins)", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: fullIssueRow({ updated_at: "2026-06-09 10:00:00" }) }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "status", issueId: 1, baseUpdatedAt: "2026-06-09 09:00:00", fields: { status: "Completed" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.status).toBe("conflict");
    expect(body.serverId).toBe(1);
  });

  it("applies a soft delete (status Deleted) for a moderator", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: fullIssueRow({ updated_at: "2026-06-09 10:00:00" }) },
        { executeTakeFirstOrThrow: fullIssueRow({ updated_at: "2026-06-09 10:00:00" }) },
        { executeTakeFirst: fullIssueRow({ status: "Deleted", updated_at: "2026-06-09 12:00:00" }) },
      ],
      update: [{ execute: [] }],
      insert: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "status", issueId: 1, baseUpdatedAt: "2026-06-09 10:00:00", fields: { status: "Deleted" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("applied");
    expect(body.issue.status).toBe("Deleted");
    expect(db.updateTable).toHaveBeenCalledWith("issue");
  });

  it("requires baseUpdatedAt for updates", async () => {
    const response = (await action(createRouteArgs({
      request: jsonRequest({ op: "update", issueId: 1, fields: { description: "x" } }),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(400);
  });
});
