import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "./discount";
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
import * as authServer from "~/lib/auth.server";
import * as dbModule from "~/lib/db";
import * as discountsServer from "~/lib/discounts.server";
import * as tagsServer from "~/lib/tags.server";

describe("discount route", () => {
  beforeEach(() => {
    vi.spyOn(tagsServer, "userHasActiveTag").mockResolvedValue(false);
    vi.spyOn(dbModule, "getDB").mockReturnValue(createMockDb() as unknown as ReturnType<typeof dbModule.getDB>);
  });

  it("returns existing code if user already has one", async () => {
    const user = createUser({ uid: "user-1", email: "user@example.com" });
    vi.spyOn(authServer, "requireUser").mockResolvedValue(user);
    vi.spyOn(dbModule, "getDB").mockReturnValue({} as any);

    const existingCode = {
      id: 1,
      codeKey: "test-code.png",
      claimedEmail: "user@example.com",
      claimedUid: "user-1",
      claimedAt: "2026-09-18 10:00:00",
    };

    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(existingCode);
    const claimSpy = vi.spyOn(discountsServer, "claimDiscountCode");

    const context = createContext();
    const request = createGetRequest("https://example.com/discount");
    const args = createRouteArgs({ request, context, params: {} });

    const result = await loader(args);
    expect(result.code).toEqual(existingCode);
    expect(result.eligible).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("claims a code if eligible and user has none", async () => {
    const user = createUser({ uid: "user-2", email: "user2@example.com" });
    vi.spyOn(authServer, "requireUser").mockResolvedValue(user);
    vi.spyOn(dbModule, "getDB").mockReturnValue({} as any);

    const newCode = {
      id: 2,
      codeKey: "new-code.png",
      claimedEmail: "user2@example.com",
      claimedUid: "user-2",
      claimedAt: "2026-09-18 11:00:00",
    };

    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(null);
    vi.spyOn(discountsServer, "isUserEligibleForDiscount").mockResolvedValue(true);
    vi.spyOn(discountsServer, "claimDiscountCode").mockResolvedValue(newCode);

    const context = createContext();
    const request = createGetRequest("https://example.com/discount");
    const args = createRouteArgs({ request, context, params: {} });

    const result = await loader(args);
    expect(result.code).toEqual(newCode);
    expect(result.eligible).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it("marks as not eligible if user does not have tag", async () => {
    const user = createUser({ uid: "user-3", email: "user3@example.com" });
    vi.spyOn(authServer, "requireUser").mockResolvedValue(user);
    vi.spyOn(dbModule, "getDB").mockReturnValue({} as any);

    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(null);
    vi.spyOn(discountsServer, "isUserEligibleForDiscount").mockResolvedValue(false);

    const context = createContext();
    const request = createGetRequest("https://example.com/discount");
    const args = createRouteArgs({ request, context, params: {} });

    const result = await loader(args);
    expect(result.code).toBeNull();
    expect(result.eligible).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it("marks as exhausted if eligible but no codes remain in pool", async () => {
    const user = createUser({ uid: "user-4", email: "user4@example.com" });
    vi.spyOn(authServer, "requireUser").mockResolvedValue(user);
    vi.spyOn(dbModule, "getDB").mockReturnValue({} as any);

    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(null);
    vi.spyOn(discountsServer, "isUserEligibleForDiscount").mockResolvedValue(true);
    vi.spyOn(discountsServer, "claimDiscountCode").mockResolvedValue(null);

    const context = createContext();
    const request = createGetRequest("https://example.com/discount");
    const args = createRouteArgs({ request, context, params: {} });

    const result = await loader(args);
    expect(result.code).toBeNull();
    expect(result.eligible).toBe(true);
    expect(result.exhausted).toBe(true);
  });

  it("loads admin stats and assignments for admin users", async () => {
    const user = createUser({ uid: "admin-1", email: "admin@example.com", role: "admin" });
    vi.spyOn(authServer, "requireUser").mockResolvedValue(user);

    const mockDb = createMockDb({
      select: [
        {
          execute: [
            {
              id: 1,
              codeKey: "claimed-code.png",
              claimedEmail: "member@example.com",
              claimedUid: "u-member",
              claimedAt: "2026-09-18 10:00:00",
            },
            {
              id: 2,
              codeKey: "unclaimed-code.png",
              claimedEmail: null,
              claimedUid: null,
              claimedAt: null,
            },
          ],
        },
      ],
    });
    vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(null);
    vi.spyOn(discountsServer, "isUserEligibleForDiscount").mockResolvedValue(false);

    const context = createContext();
    const request = createGetRequest("https://example.com/discount");
    const args = createRouteArgs({ request, context, params: {} });

    const result = await loader(args);
    expect(result.adminStats).toBeDefined();
    expect(result.adminStats?.total).toBe(2);
    expect(result.adminStats?.claimedCount).toBe(1);
    expect(result.adminStats?.unclaimedCount).toBe(1);
    expect(result.adminStats?.assignments).toHaveLength(1);
    expect(result.adminStats?.assignments[0].claimedEmail).toBe("member@example.com");
  });

  describe("action", () => {
    it("returns 403 if non-admin attempts action", async () => {
      const user = createUser({ uid: "user-1", email: "user@example.com", role: "member" });
      vi.spyOn(authServer, "requireUser").mockResolvedValue(user);

      const context = createContext();
      const request = createFormRequest("https://example.com/discount", {
        action: "unassign_code",
        code_id: "1",
      });
      const args = createRouteArgs({ request, context, params: {} });

      const response = await action(args);
      expect(getStatus(response)).toBe(403);
    });

    it("successfully unassigns a claimed code", async () => {
      const user = createUser({ uid: "admin-1", email: "admin@example.com", role: "admin" });
      vi.spyOn(authServer, "requireUser").mockResolvedValue(user);

      const mockDb = createMockDb({
        update: [{ execute: [] }],
      });
      vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

      const context = createContext();
      const request = createFormRequest("https://example.com/discount", {
        action: "unassign_code",
        code_id: "42",
      });
      const args = createRouteArgs({ request, context, params: {} });

      const response = await action(args);
      const json = await readJson(response);
      expect(json.success).toBe(true);
      expect(json.message).toContain("unassigned");
    });

    it("refuses to delete an assigned code", async () => {
      const user = createUser({ uid: "admin-1", email: "admin@example.com", role: "admin" });
      vi.spyOn(authServer, "requireUser").mockResolvedValue(user);

      const mockDb = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 42,
              codeKey: "assigned.png",
              claimedEmail: "user@example.com",
            },
          },
        ],
      });
      vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

      const context = createContext();
      const request = createFormRequest("https://example.com/discount", {
        action: "delete_code",
        code_id: "42",
      });
      const args = createRouteArgs({ request, context, params: {} });

      const response = await action(args);
      expect(getStatus(response)).toBe(400);
      const json = await readJson(response);
      expect(json.error).toContain("Cannot delete an assigned code");
    });

    it("successfully deletes an unassigned code from DB and R2", async () => {
      const user = createUser({ uid: "admin-1", email: "admin@example.com", role: "admin" });
      vi.spyOn(authServer, "requireUser").mockResolvedValue(user);

      const mockDb = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 99,
              codeKey: "unassigned.png",
              claimedEmail: null,
            },
          },
        ],
        delete: [{ execute: [] }],
      });
      vi.spyOn(dbModule, "getDB").mockReturnValue(mockDb as any);

      const context = createContext();
      const request = createFormRequest("https://example.com/discount", {
        action: "delete_code",
        code_id: "99",
      });
      const args = createRouteArgs({ request, context, params: {} });

      const response = await action(args);
      const json = await readJson(response);
      expect(json.success).toBe(true);
      expect(json.message).toContain("deleted");
      expect(context.cloudflare.env.TABVAR_MISC.delete).toHaveBeenCalledWith("unassigned.png");
    });
  });

  it.each([true, false])("only loads management data with active manager access (%s)", async (active) => {
    vi.mocked(tagsServer.userHasActiveTag).mockRestore();
    vi.spyOn(authServer, "requireUser").mockResolvedValue(createUser());
    vi.spyOn(discountsServer, "getUserDiscountCode").mockResolvedValue(null);
    vi.spyOn(discountsServer, "isUserEligibleForDiscount").mockResolvedValue(false);
    const db = createMockDb({ select: [
      { executeTakeFirst: { id: 1, expiresAt: active ? null : "2020-01-01" } },
      { execute: [] },
    ] });
    vi.mocked(dbModule.getDB).mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDB>);
    const result = await loader(createRouteArgs({ request: createGetRequest(), context: createContext(), params: {} }));
    expect(result.adminStats).toEqual(active ? expect.objectContaining({ total: 0 }) : null);
    expect(db.__queries[0].where).toHaveBeenCalledWith("t.name", "=", "supporter_prog_manager");
    expect(db.selectFrom).toHaveBeenCalledTimes(active ? 2 : 1);
  });

  it.each(["unassign_code", "delete_code", "add_supporter"])("rejects %s from an expired manager", async (formAction) => {
    vi.mocked(tagsServer.userHasActiveTag).mockRestore();
    vi.spyOn(authServer, "requireUser").mockResolvedValue(createUser());
    const db = createMockDb({ select: [{ executeTakeFirst: { id: 1, expiresAt: "2020-01-01" } }] });
    vi.mocked(dbModule.getDB).mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDB>);
    const response = await action(createRouteArgs({ request: createFormRequest("https://example.com/discount", {
      action: formAction, code_id: "42", email: "supporter@example.com",
    }), context: createContext(), params: {} }));
    expect(getStatus(response)).toBe(403);
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
    expect(db.deleteFrom).not.toHaveBeenCalled();
  });

  it.each(["unassign_code", "delete_code"])("allows an active manager to %s", async (formAction) => {
    vi.mocked(tagsServer.userHasActiveTag).mockRestore();
    vi.spyOn(authServer, "requireUser").mockResolvedValue(createUser());
    const db = createMockDb({ select: [
      { executeTakeFirst: { id: 1, expiresAt: "2099-01-01" } },
      { executeTakeFirst: { id: 42, codeKey: "available.png", claimedEmail: null } },
    ] });
    vi.mocked(dbModule.getDB).mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDB>);
    const response = await action(createRouteArgs({ request: createFormRequest("https://example.com/discount", {
      action: formAction, code_id: "42",
    }), context: createContext(), params: {} }));
    expect((await readJson(response)).success).toBe(true);
    if (formAction === "unassign_code") {
      expect(db.__queries[1].set).toHaveBeenCalledWith({ claimed_email: null, claimed_uid: null, claimed_at: null });
    } else {
      expect(db.deleteFrom).toHaveBeenCalledWith("user_discount_code");
    }
  });

  describe("add super supporter", () => {
    beforeEach(() => {
      vi.spyOn(authServer, "requireUser").mockResolvedValue(createUser({ uid: "admin-1", role: "admin" }));
    });

    async function submitEmail(db: ReturnType<typeof createMockDb>, email = " SUPPORTER@Example.com ") {
      vi.mocked(dbModule.getDB).mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDB>);
      return action(createRouteArgs({
        request: createFormRequest("https://example.com/discount", { action: "add_supporter", email }),
        context: createContext(), params: {},
      }));
    }

    it.each(["", "bad-email", "two@example.com other@example.com"])("rejects invalid email %s", async (email) => {
      const db = createMockDb();
      expect(getStatus(await submitEmail(db, email))).toBe(400);
      expect(db.selectFrom).not.toHaveBeenCalled();
    });

    it("reports a missing discount tag without creating anything", async () => {
      const db = createMockDb();
      const response = await submitEmail(db);
      expect(getStatus(response)).toBe(500);
      expect((await readJson(response)).error).toContain("tag is missing");
      expect(db.insertInto).not.toHaveBeenCalled();
    });

    it("tags an existing user and records who assigned it", async () => {
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, { executeTakeFirst: { uid: "target-1" } }, {},
      ], insert: [{ executeTakeFirst: { id: 10 } }] });
      expect((await readJson(await submitEmail(db))).message).toContain("added to supporter@example.com");
      expect(db.__queries[0].where).toHaveBeenCalledWith("name", "=", "super_supporter_2026");
      expect(db.__queries[1].where).toHaveBeenCalledWith(expect.anything(), "=", "supporter@example.com");
      expect(db.__queries[3].values).toHaveBeenCalledWith({ uid: "target-1", tag_id: 7, expires_at: null, assigned_by_uid: "admin-1" });
      expect(db.insertInto).toHaveBeenCalledWith("user_tag_assignment");
      expect(db.insertInto).not.toHaveBeenCalledWith("user_invite");
    });

    it("reports an already active user tag without changing it", async () => {
      vi.mocked(tagsServer.userHasActiveTag).mockResolvedValue(true);
      const db = createMockDb({ select: [{ executeTakeFirst: { id: 7 } }, { executeTakeFirst: { uid: "target-1" } }] });
      expect((await readJson(await submitEmail(db))).info).toBe(true);
      expect(db.insertInto).not.toHaveBeenCalled();
      expect(db.updateTable).not.toHaveBeenCalled();
    });

    it("renews an expired user tag", async () => {
      vi.mocked(tagsServer.userHasActiveTag).mockRestore();
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, { executeTakeFirst: { uid: "target-1" } },
        { executeTakeFirst: { id: 10, expiresAt: "2020-01-01" } }, { executeTakeFirst: { id: 10 } },
      ] });
      expect((await readJson(await submitEmail(db))).success).toBe(true);
      expect(db.__queries[4].set).toHaveBeenCalledWith({ expires_at: null, assigned_by_uid: "admin-1" });
      expect(db.insertInto).not.toHaveBeenCalled();
    });

    it("adds to an existing invite without modifying its role or other tags", async () => {
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, {}, { executeTakeFirst: { email: "supporter@example.com" } }, {},
      ] });
      expect((await readJson(await submitEmail(db))).message).toContain("existing invite");
      expect(db.insertInto).toHaveBeenCalledTimes(1);
      expect(db.insertInto).toHaveBeenCalledWith("user_invite_tag");
      expect(db.__queries[4].values).toHaveBeenCalledWith({ email: "supporter@example.com", tag_id: 7, expires_at: null });
      expect(db.updateTable).not.toHaveBeenCalled();
      expect(db.deleteFrom).not.toHaveBeenCalled();
    });

    it.each([null, "2099-01-01"])("reports an already active invite tag (%s) without changes", async (expiresAt) => {
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, {}, { executeTakeFirst: { email: "supporter@example.com" } },
        { executeTakeFirst: { id: 10, expiresAt } },
      ] });
      expect((await readJson(await submitEmail(db))).info).toBe(true);
      expect(db.insertInto).not.toHaveBeenCalled();
      expect(db.updateTable).not.toHaveBeenCalled();
    });

    it("renews an expired invite tag", async () => {
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, {}, { executeTakeFirst: { email: "supporter@example.com" } },
        { executeTakeFirst: { id: 10, expiresAt: "2020-01-01" } },
      ] });
      expect((await readJson(await submitEmail(db))).success).toBe(true);
      expect(db.__queries[4].set).toHaveBeenCalledWith({ expires_at: null });
      expect(db.insertInto).not.toHaveBeenCalled();
    });

    it("creates a member invite with the supporter tag for a new email, including for managers", async () => {
      vi.spyOn(authServer, "requireUser").mockResolvedValue(createUser({ uid: "manager-1", displayName: "Manager" }));
      vi.mocked(tagsServer.userHasActiveTag).mockResolvedValue(true);
      const db = createMockDb({ select: [{ executeTakeFirst: { id: 7 } }, {}, {}] });
      expect((await readJson(await submitEmail(db))).message).toContain("Member invite created");
      expect(db.__queries[3].values).toHaveBeenCalledWith(expect.objectContaining({
        email: "supporter@example.com", role: "member", invited_by_uid: "manager-1", invited_by_name: "Manager",
      }));
      expect(db.__queries[4].values).toHaveBeenCalledWith({ email: "supporter@example.com", tag_id: 7, expires_at: null });
      expect(db.insertInto).toHaveBeenCalledTimes(2);
    });

    it("reports a database failure instead of success", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const db = createMockDb({ select: [
        { executeTakeFirst: { id: 7 } }, {}, { executeTakeFirst: { email: "supporter@example.com" } }, {},
      ], insert: [{ execute: new Error("Database unavailable") }] });
      const response = await submitEmail(db);
      expect(getStatus(response)).toBe(500);
      expect((await readJson(response)).error).toContain("Please retry");
      expect(console.error).toHaveBeenCalledWith("Failed to add super supporter tag:", expect.any(Error));
    });
  });
});
