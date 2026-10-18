import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import { D1Dialect } from "@notsplol/kysely-d1";
import type { DB } from "~/lib/db.d";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createUser,
  getStatus,
  readJson,
  createRouteArgs,
} from "~/test/helpers";
import { PERMISSION_ERROR } from "~/lib/constants";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  recalculateAttachmentHashes: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/attachment.server", () => ({
  recalculateAttachmentHashes: mocks.recalculateAttachmentHashes,
}));

import { action, loader } from "./admin.query";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

describe("admin.query route", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));

    sqlite.exec(`
      CREATE TABLE crag (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO crag (id, name) VALUES (1, 'Test Crag');
    `);
  });

  afterEach(() => {
    sqlite?.close();
  });

  describe("loader", () => {
    it("returns the environment from context for admins", async () => {
      const response = await loader(
        createRouteArgs({
          request: createGetRequest("https://example.com/admin/query"),
          context: createContext({ ENVIRONMENT: "staging" }),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body).toEqual({ environment: "staging" });
    });

    it("rejects non-admin users with 403", async () => {
      mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

      const response = await loader(
        createRouteArgs({
          request: createGetRequest("https://example.com/admin/query"),
          context: createContext({ ENVIRONMENT: "staging" }),
          params: {},
        })
      );

      expect(getStatus(response)).toBe(403);
      const body = await readJson(response);
      expect(body.error).toBe(PERMISSION_ERROR);
    });
  });

  describe("action permissions", () => {
    it("rejects non-admin users with 403", async () => {
      mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "SELECT * FROM crag",
          }),
          context: createContext(),
          params: {},
        })
      );

      expect(getStatus(response)).toBe(403);
      const body = await readJson(response);
      expect(body.error).toBe(PERMISSION_ERROR);
    });
  });

  describe("action query execution", () => {
    it("returns an error if no query is provided", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "   ",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.error).toBe("No query provided");
    });

    it("runs a SELECT query and returns rows, numRows, columns, and query", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "SELECT id, name FROM crag WHERE id = 1",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.numRows).toBe(1);
      expect(body.columns).toEqual(["id", "name"]);
      expect(body.rows).toEqual([{ id: 1, name: "Test Crag" }]);
      expect(body.query).toBe("SELECT id, name FROM crag WHERE id = 1");
    });

    it("runs an UPDATE query and handles affected rows", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "UPDATE crag SET name = 'Updated Crag' WHERE id = 1",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.numRows).toBe(1);
      expect(body.rows).toEqual([]);

      const updated = await db
        .selectFrom("crag")
        .select("name")
        .where("id", "=", 1)
        .executeTakeFirst();
      expect(updated?.name).toBe("Updated Crag");
    });

    it("handles SQL syntax errors gracefully without crashing", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "SELECT * FORM crag",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.error).toBeDefined();
      expect(body.query).toBe("SELECT * FORM crag");
    });

    it("executes queries successfully with D1Dialect without kind property errors", async () => {
      const mockD1 = {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({
            results: [{ id: 1, name: "D1 Crag" }],
            meta: { changes: 0, last_row_id: null, duration: 1 },
          }),
          run: vi.fn().mockResolvedValue({
            results: [],
            meta: { changes: 0, last_row_id: null, duration: 1 },
          }),
        })),
        dump: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      };

      const d1Db = new Kysely<DB>({
        dialect: new D1Dialect({ database: mockD1 as any }),
      });
      mocks.getDB.mockReturnValue(d1Db);

      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            query: "SELECT * FROM crag",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.rows).toEqual([{ id: 1, name: "D1 Crag" }]);
      expect(body.numRows).toBe(1);
      expect(mockD1.prepare).toHaveBeenCalledWith("SELECT * FROM crag");
    });
  });

  describe("action hash recalculation", () => {
    it("calls recalculateAttachmentHashes and returns stats", async () => {
      mocks.recalculateAttachmentHashes.mockResolvedValue({
        issues: { total: 10, updated: 8, duplicates: 0, errors: 0 },
        topos: { total: 5, updated: 5, errors: 0 },
        duplicates: [],
        errors: [],
      });

      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/admin/query", {
            _action: "recalculate_hashes",
          }),
          context: createContext(),
          params: {},
        })
      );

      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.hashStats).toBeDefined();
      expect(body.message).toContain("Attachment hashes recalculated successfully");
    });
  });
});
