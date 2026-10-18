// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
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

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

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
    attachment_hash: null,
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
            issueRow({ attachment_id: 11, attachment_url: "https://x/1.jpg", attachment_name: "1.jpg", attachment_type: "image/jpeg", attachment_hash: "hash123" }),
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
    const body = (await response.json()) as any;
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0].attachments).toHaveLength(2);
    expect(body.issues[0].attachments[0]).toMatchObject({ id: 11, url: "https://x/1.jpg", hash: "hash123" });
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

describe("api.v1.issues loader visibility (SQLite)", () => {
  let db: Kysely<DB>;

  async function pull(role: string, uid: string, since?: string) {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role, uid }));
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = (await loader(createRouteArgs({
      request: createGetRequest(`https://example.com/api/v1/issues${query}`),
      context: createContext(),
      params: {},
    }))) as Response;
    return (await response.json()) as { issues: { id: number }[]; hiddenIssueIds: number[]; serverTime: string };
  }

  const ids = (body: { issues: { id: number }[] }) => body.issues.map((issue) => issue.id).sort();

  beforeEach(() => {
    vi.clearAllMocks();
    const sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    // The columns the pull reads; the full issue table is built across many migrations.
    sqlite.exec(`
      CREATE TABLE issue (
        id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL, crag_id INTEGER, issue_type TEXT NOT NULL,
        sub_issue_type TEXT, status TEXT NOT NULL, last_status TEXT, description TEXT, bolts_affected TEXT,
        is_flagged INTEGER, flagged_message TEXT, reported_by TEXT, reported_by_uid TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT, last_modified TEXT,
        approved_at TEXT, archived_at TEXT
      );
      CREATE TABLE issue_attachment (
        id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL, url TEXT NOT NULL, name TEXT, type TEXT NOT NULL, file_hash TEXT
      );
      INSERT INTO issue (id, route_id, issue_type, status, reported_by_uid, updated_at) VALUES
        (1, 100, 'Bolts', 'Reported',      'someone', '2026-06-01 00:00:00'),
        (2, 100, 'Bolts', 'In Moderation', 'me',      '2026-06-02 00:00:00'),
        (3, 100, 'Bolts', 'In Moderation', 'someone', '2026-06-03 00:00:00'),
        (4, 100, 'Bolts', 'Archived',      'someone', '2026-06-04 00:00:00'),
        (5, 100, 'Bolts', 'Archived',      'me',      '2026-06-05 00:00:00'),
        (6, 100, 'Bolts', 'Deleted',       'someone', '2026-06-06 00:00:00');
    `);
    mocks.getDB.mockReturnValue(db);
  });

  it.each(["admin", "super"])("gives %s every issue", async (role) => {
    expect(ids(await pull(role, "reviewer"))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(["member", "anonymous"])("hides archived issues and others' moderated issues from %s", async (role) => {
    const body = await pull(role, "me");

    expect(ids(body)).toEqual([1, 2, 6]);
    expect(body.hiddenIssueIds).toEqual([]);
  });

  it("lists issues hidden from the caller on a delta pull and advances the cursor past them", async () => {
    const body = await pull("member", "me", "2026-06-02 00:00:00");

    expect(ids(body)).toEqual([2, 6]);
    expect(body.hiddenIssueIds.sort()).toEqual([3, 4, 5]);
    expect(body.serverTime).toBe("2026-06-06 00:00:00");
  });

  it("doesn't list hidden issues for reviewers, who get them all", async () => {
    const body = await pull("admin", "reviewer", "2026-06-02 00:00:00");

    expect(ids(body)).toEqual([2, 3, 4, 5, 6]);
    expect(body.hiddenIssueIds).toEqual([]);
  });
});
