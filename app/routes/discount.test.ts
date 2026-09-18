import { describe, expect, it, vi } from "vitest";
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

describe("discount route", () => {
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
});
