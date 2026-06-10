// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createMockDb, createRouteArgs } from "~/test/helpers";

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

import { loader } from "./api.v1.issues";

function tokenUser(overrides: Record<string, unknown> = {}) {
  return { tokenId: "t1", uid: "u1", client: "topobuilder", role: "member", displayName: "Mod", ...overrides };
}

function issueRow(overrides: Record<string, unknown> = {}) {
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
    attachment_id: null,
    attachment_url: null,
    attachment_name: null,
    attachment_type: null,
    ...overrides,
  };
}

describe("api.v1.issues loader (pull)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser());
  });

  it("groups attachments by issue and returns the max updated_at as serverTime", async () => {
    const db = createMockDb({
      select: [
        {
          execute: [
            issueRow({ attachment_id: 11, attachment_url: "https://x/1.jpg", attachment_name: "1.jpg", attachment_type: "image/jpeg" }),
            issueRow({ attachment_id: 12, attachment_url: "https://x/2.jpg", attachment_name: "2.jpg", attachment_type: "image/jpeg" }),
            issueRow({ id: 2, status: "Deleted", updated_at: "2026-06-09 11:00:00" }),
          ],
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/issues"),
      context: createContext(),
      params: {},
    }))) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0].attachments).toHaveLength(2);
    expect(body.issues[1].status).toBe("Deleted");
    expect(body.serverTime).toBe("2026-06-09 11:00:00");
  });

  it("applies the since cursor as an inclusive filter", async () => {
    const db = createMockDb({ select: [{ execute: [] }] });
    mocks.getDB.mockReturnValue(db);

    await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/issues?since=2026-06-09%2009:00:00"),
      context: createContext(),
      params: {},
    }));

    expect(db.__queries[0].where).toHaveBeenCalledWith("issue.updated_at", ">=", "2026-06-09 09:00:00");
  });

  it("rejects when the token is invalid", async () => {
    mocks.requireApiTokenUser.mockRejectedValue(new Response(null, { status: 401 }));

    const response = (await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/v1/issues"),
      context: createContext(),
      params: {},
    })).catch((e) => e)) as Response;

    expect(response.status).toBe(401);
  });
});
