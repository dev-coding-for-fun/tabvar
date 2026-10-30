// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/lib/db.d";
import { createContext, createFormRequest, createGetRequest, createRouteArgs, createUser, getStatus, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({ getDB: vi.fn(), getSessionUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("~/lib/db", () => ({ getDB: mocks.getDB }));
vi.mock("~/lib/auth.server", () => ({ getSessionUser: mocks.getSessionUser, requireUser: mocks.requireUser }));

import { action, loader } from "./goldencrowbar._index";
import { loader as resultsLoader } from "./goldencrowbar.results";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

describe("2026 Golden Crowbar ballot", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;
  const user = createUser({ uid: "voter" });
  const args = (candidateId: string) => createRouteArgs({
    request: createFormRequest("https://example.com/goldencrowbar", { candidateId }),
    context: createContext(), params: {},
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE user (uid TEXT PRIMARY KEY); INSERT INTO user VALUES ('voter');");
    for (const file of ["0053_add_goldencrowbar.sql", "0073_golden_crowbar_2026.sql"]) {
      sqlite.exec(readFileSync(resolve("migrations", file), "utf8"));
    }
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(user);
    mocks.getSessionUser.mockResolvedValue(null);
  });

  afterEach(async () => { await db.destroy(); });

  it("seeds the 15 nominees once with the Edmonton deadline", async () => {
    sqlite.exec(readFileSync(resolve("migrations", "0073_golden_crowbar_2026.sql"), "utf8"));
    const campaign = await db.selectFrom("campaign").selectAll().execute();
    const candidates = await db.selectFrom("campaign_candidate").selectAll().execute();
    expect(campaign).toHaveLength(1);
    expect(campaign[0].end_date).toBe("2026-12-05 06:59:59");
    expect(candidates).toHaveLength(15);
  });

  it("shows every nominee and associates a signed-in voter with their choice", async () => {
    sqlite.exec("UPDATE campaign SET end_date = '2099-01-01 00:00:00'; INSERT INTO vote (campaign_id, uid, campaign_candidate_id) VALUES (1, 'voter', 1)");
    mocks.getSessionUser.mockResolvedValue(user);
    const response = (await loader(createRouteArgs({ request: createGetRequest("https://example.com/goldencrowbar"), context: createContext(), params: {} }))).data;
    expect(response.ready).toBe(true);
    expect(response.isOpen).toBe(true);
    expect(response.vote).toBe(1);
    expect(response.nominees).toHaveLength(15);
    expect(response.nominees[0].name).toBe("Ethan Woodside");
  });

  it("records one vote per user and does not replace it on a second request", async () => {
    sqlite.exec("UPDATE campaign SET end_date = '2099-01-01 00:00:00'");
    expect(await readJson(await action(args("1")))).toEqual({ success: true });
    expect(getStatus(await action(args("2")))).toBe(409);
    expect(await db.selectFrom("vote").selectAll().execute()).toMatchObject([{ uid: "voter", campaign_candidate_id: 1 }]);
  });

  it("rejects votes after the deadline", async () => {
    sqlite.exec("UPDATE campaign SET end_date = '2000-01-01 00:00:00'");
    expect(getStatus(await action(args("1")))).toBe(409);
    expect(await db.selectFrom("vote").selectAll().execute()).toHaveLength(0);
  });

  it("rejects candidates from another campaign and unknown nominees", async () => {
    sqlite.exec(`UPDATE campaign SET end_date = '2099-01-01 00:00:00';
      INSERT INTO campaign (id, name, end_date) VALUES (2, 'Other award', '2099-01-01');
      INSERT INTO campaign_candidate (id, campaign_id, name) VALUES (99, 2, 'Ethan Woodside'), (100, 1, 'Not a nominee');`);
    expect(getStatus(await action(args("99")))).toBe(409);
    expect(getStatus(await action(args("100")))).toBe(409);
    expect(await db.selectFrom("vote").selectAll().execute()).toHaveLength(0);
  });

  it("does not accept votes when the ballot is missing a nominee", async () => {
    sqlite.exec("UPDATE campaign SET end_date = '2099-01-01 00:00:00'; DELETE FROM campaign_candidate WHERE id = 15");
    const page = (await loader(createRouteArgs({ request: createGetRequest("https://example.com/goldencrowbar"), context: createContext(), params: {} }))).data;
    expect(page.ready).toBe(false);
    expect(getStatus(await action(args("1")))).toBe(409);
    expect(await db.selectFrom("vote").selectAll().execute()).toHaveLength(0);
  });

  it("requires a valid nominee ID and an authenticated voter", async () => {
    expect(getStatus(await action(args("1xyz")))).toBe(400);
    mocks.requireUser.mockRejectedValue(new Response(null, { status: 302, headers: { Location: "/login" } }));
    await expect(action(args("1"))).rejects.toMatchObject({ status: 302 });
    expect(await db.selectFrom("vote").selectAll().execute()).toHaveLength(0);
  });

  it("keeps results private and counts votes including nominees with no votes", async () => {
    const request = createRouteArgs({ request: createGetRequest("https://example.com/goldencrowbar/results"), context: createContext(), params: {} });
    await expect(resultsLoader(request)).rejects.toMatchObject({ status: 403 });
    mocks.requireUser.mockResolvedValue(createUser({ role: "super" }));
    await expect(resultsLoader(request)).rejects.toMatchObject({ status: 403 });
    sqlite.exec("INSERT INTO vote (campaign_id, uid, campaign_candidate_id) VALUES (1, 'voter', 1)");
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    const result = (await resultsLoader(request)).data;
    expect(result.total).toBe(1);
    expect(result.candidates).toHaveLength(15);
    expect(result.candidates[0]).toMatchObject({ name: "Ethan Woodside", votes: 1 });
    expect(result.candidates.filter((candidate) => Number(candidate.votes) === 0)).toHaveLength(14);
  });
});
