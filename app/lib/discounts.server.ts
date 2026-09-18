import { sql, type Kysely } from "kysely";
import type { DB } from "./db.d";

export const DEFAULT_DISCOUNT_TAG = "super_supporter_2026";

export interface ClaimedDiscountCode {
  id: number;
  codeKey: string;
  claimedEmail: string;
  claimedUid: string;
  claimedAt: string;
}

/**
 * Retrieves an already claimed discount code for a user by email or UID.
 */
export async function getUserDiscountCode(
  db: Kysely<DB>,
  email?: string | null,
  uid?: string | null
): Promise<ClaimedDiscountCode | null> {
  if (!email && !uid) return null;

  const normalizedEmail = email ? email.trim().toLowerCase() : null;

  let query = db.selectFrom("user_discount_code")
    .select([
      "id",
      "code_key as codeKey",
      "claimed_email as claimedEmail",
      "claimed_uid as claimedUid",
      "claimed_at as claimedAt",
    ]);

  if (normalizedEmail && uid) {
    query = query.where((eb) =>
      eb.or([
        eb("claimed_email", "=", normalizedEmail),
        eb("claimed_uid", "=", uid),
      ])
    );
  } else if (normalizedEmail) {
    query = query.where("claimed_email", "=", normalizedEmail);
  } else if (uid) {
    query = query.where("claimed_uid", "=", uid);
  }

  const row = await query.executeTakeFirst();
  if (!row || !row.id || !row.claimedEmail || !row.claimedUid || !row.claimedAt) {
    return null;
  }

  return {
    id: row.id,
    codeKey: row.codeKey,
    claimedEmail: row.claimedEmail,
    claimedUid: row.claimedUid,
    claimedAt: row.claimedAt,
  };
}

/**
 * Checks if a user has an active (non-expired) tag matching the discount eligibility tag.
 */
export async function isUserEligibleForDiscount(
  db: Kysely<DB>,
  uid: string,
  tagName: string = DEFAULT_DISCOUNT_TAG
): Promise<boolean> {
  if (!uid) return false;

  const assignment = await db
    .selectFrom("user_tag_assignment as a")
    .innerJoin("user_tag as t", "a.tag_id", "t.id")
    .select(["a.id", "a.expires_at as expiresAt"])
    .where("a.uid", "=", uid)
    .where("t.name", "=", tagName)
    .executeTakeFirst();

  if (!assignment) {
    return false;
  }

  if (assignment.expiresAt) {
    const expires = new Date(assignment.expiresAt);
    if (expires < new Date()) {
      return false;
    }
  }

  return true;
}

/**
 * Atomically claims a discount code for a user.
 * If the user already has a code, returns the existing code.
 * If no codes are remaining, returns null.
 */
export async function claimDiscountCode(
  db: Kysely<DB>,
  email: string,
  uid: string
): Promise<ClaimedDiscountCode | null> {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Check if user already claimed one
  const existing = await getUserDiscountCode(db, normalizedEmail, uid);
  if (existing) {
    return existing;
  }

  // 2. Find next available code
  const unclaimed = await db
    .selectFrom("user_discount_code")
    .select("id")
    .where("claimed_email", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (!unclaimed || unclaimed.id === null) {
    return null; // Exhausted
  }

  // 3. Atomically update claiming email/uid
  const claimed = await db
    .updateTable("user_discount_code")
    .set({
      claimed_email: normalizedEmail,
      claimed_uid: uid,
      claimed_at: sql<string>`DATETIME('now')`,
    })
    .where("id", "=", unclaimed.id)
    .where("claimed_email", "is", null)
    .returning([
      "id",
      "code_key as codeKey",
      "claimed_email as claimedEmail",
      "claimed_uid as claimedUid",
      "claimed_at as claimedAt",
    ])
    .executeTakeFirst();

  if (!claimed || !claimed.id || !claimed.claimedEmail || !claimed.claimedUid || !claimed.claimedAt) {
    // Retry once in case of rare race condition on the same unclaimed ID
    return getUserDiscountCode(db, normalizedEmail, uid);
  }

  return {
    id: claimed.id,
    codeKey: claimed.codeKey,
    claimedEmail: claimed.claimedEmail,
    claimedUid: claimed.claimedUid,
    claimedAt: claimed.claimedAt,
  };
}
