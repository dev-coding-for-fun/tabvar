import { describe, expect, it } from "vitest";
import {
  getUserDiscountCode,
  isUserEligibleForDiscount,
  claimDiscountCode,
  DEFAULT_DISCOUNT_TAG,
} from "./discounts.server";
import { createMockDb } from "~/test/helpers";
import type { DB } from "./db.d";
import type { Kysely } from "kysely";

describe("discounts.server", () => {
  describe("getUserDiscountCode", () => {
    it("returns null if neither email nor uid provided", async () => {
      const db = createMockDb() as unknown as Kysely<DB>;
      const result = await getUserDiscountCode(db, null, null);
      expect(result).toBeNull();
    });

    it("returns null if no code found", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: null }],
      }) as unknown as Kysely<DB>;
      const result = await getUserDiscountCode(db, "test@example.com", "u1");
      expect(result).toBeNull();
    });

    it("returns the claimed code if found", async () => {
      const db = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 1,
              codeKey: "qr-code-123.png",
              claimedEmail: "test@example.com",
              claimedUid: "u1",
              claimedAt: "2026-09-18 10:00:00",
            },
          },
        ],
      }) as unknown as Kysely<DB>;

      const result = await getUserDiscountCode(db, "test@example.com", "u1");
      expect(result).toEqual({
        id: 1,
        codeKey: "qr-code-123.png",
        claimedEmail: "test@example.com",
        claimedUid: "u1",
        claimedAt: "2026-09-18 10:00:00",
      });
    });
  });

  describe("isUserEligibleForDiscount", () => {
    it("returns false if uid is empty", async () => {
      const db = createMockDb() as unknown as Kysely<DB>;
      const result = await isUserEligibleForDiscount(db, "");
      expect(result).toBe(false);
    });

    it("returns false if user does not have tag", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: null }],
      }) as unknown as Kysely<DB>;
      const result = await isUserEligibleForDiscount(db, "u1", DEFAULT_DISCOUNT_TAG);
      expect(result).toBe(false);
    });

    it("returns false if tag assignment is expired", async () => {
      const db = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 10,
              expiresAt: "2020-01-01 00:00:00",
            },
          },
        ],
      }) as unknown as Kysely<DB>;
      const result = await isUserEligibleForDiscount(db, "u1", DEFAULT_DISCOUNT_TAG);
      expect(result).toBe(false);
    });

    it("returns true if tag assignment is active (no expiration or future)", async () => {
      const db = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 10,
              expiresAt: "2099-01-01 00:00:00",
            },
          },
        ],
      }) as unknown as Kysely<DB>;
      const result = await isUserEligibleForDiscount(db, "u1", DEFAULT_DISCOUNT_TAG);
      expect(result).toBe(true);
    });
  });

  describe("claimDiscountCode", () => {
    it("returns existing code if already claimed", async () => {
      const db = createMockDb({
        select: [
          {
            executeTakeFirst: {
              id: 1,
              codeKey: "existing.png",
              claimedEmail: "user@example.com",
              claimedUid: "u1",
              claimedAt: "2026-09-18 10:00:00",
            },
          },
        ],
      }) as unknown as Kysely<DB>;

      const result = await claimDiscountCode(db, "user@example.com", "u1");
      expect(result).toEqual({
        id: 1,
        codeKey: "existing.png",
        claimedEmail: "user@example.com",
        claimedUid: "u1",
        claimedAt: "2026-09-18 10:00:00",
      });
    });

    it("returns null if no unclaimed codes remain in pool", async () => {
      const db = createMockDb({
        select: [
          { executeTakeFirst: null }, // First check: not claimed by user
          { executeTakeFirst: null }, // Second check: no unclaimed code found
        ],
      }) as unknown as Kysely<DB>;

      const result = await claimDiscountCode(db, "new@example.com", "u2");
      expect(result).toBeNull();
    });

    it("claims and returns code successfully", async () => {
      const db = createMockDb({
        select: [
          { executeTakeFirst: null }, // First check: not claimed by user
          { executeTakeFirst: { id: 42 } }, // Found unclaimed row with id 42
        ],
        update: [
          {
            executeTakeFirst: {
              id: 42,
              codeKey: "new-code.png",
              claimedEmail: "new@example.com",
              claimedUid: "u2",
              claimedAt: "2026-09-18 12:00:00",
            },
          },
        ],
      }) as unknown as Kysely<DB>;

      const result = await claimDiscountCode(db, "new@example.com", "u2");
      expect(result).toEqual({
        id: 42,
        codeKey: "new-code.png",
        claimedEmail: "new@example.com",
        claimedUid: "u2",
        claimedAt: "2026-09-18 12:00:00",
      });
    });
  });
});
