import { type Kysely, sql } from "kysely";
import type { DB } from "./db.d";
import type { UserAssignedTag, UserTag } from "./models";

export interface TagWithUsageCount extends UserTag {
  activeCount: number;
}

/**
 * Returns all tag definitions with their active assignee counts.
 */
export async function getAllTags(db: Kysely<DB>): Promise<TagWithUsageCount[]> {
  const tags = await db
    .selectFrom("user_tag")
    .selectAll()
    .orderBy("name", "asc")
    .execute();

  const now = new Date().toISOString();

  // Active assignments are unexpired or have no expiration date
  const activeAssignments = await db
    .selectFrom("user_tag_assignment")
    .select(["tag_id", sql<number>`count(id)`.as("count")])
    .where((eb) =>
      eb.or([
        eb("expires_at", "is", null),
        eb("expires_at", ">", now),
      ])
    )
    .groupBy("tag_id")
    .execute();

  const countMap = new Map<number, number>();
  for (const item of activeAssignments) {
    countMap.set(Number(item.tag_id), Number(item.count));
  }

  return tags.map((t) => ({
    id: Number(t.id),
    name: t.name,
    description: t.description,
    color: t.color || "blue",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    activeCount: countMap.get(Number(t.id)) ?? 0,
  }));
}

/**
 * Returns all tag assignments mapped by user ID.
 */
export async function getAllUserTagAssignmentsMap(
  db: Kysely<DB>
): Promise<Map<string, UserAssignedTag[]>> {
  const assignments = await db
    .selectFrom("user_tag_assignment as a")
    .innerJoin("user_tag as t", "a.tag_id", "t.id")
    .select([
      "a.id as assignmentId",
      "a.uid as uid",
      "a.tag_id as tagId",
      "t.name as name",
      "t.description as description",
      "t.color as color",
      "a.expires_at as expiresAt",
    ])
    .orderBy("t.name", "asc")
    .execute();

  const now = new Date();
  const map = new Map<string, UserAssignedTag[]>();

  for (const row of assignments) {
    const isExpired = row.expiresAt ? new Date(row.expiresAt) < now : false;
    const tag: UserAssignedTag = {
      assignmentId: Number(row.assignmentId),
      tagId: Number(row.tagId),
      name: row.name,
      description: row.description,
      color: row.color || "blue",
      expiresAt: row.expiresAt,
      isExpired,
    };

    const existing = map.get(row.uid) || [];
    existing.push(tag);
    map.set(row.uid, existing);
  }

  return map;
}

/**
 * Returns all tags for a given user.
 */
export async function getUserTags(
  db: Kysely<DB>,
  uid: string
): Promise<UserAssignedTag[]> {
  const assignments = await db
    .selectFrom("user_tag_assignment as a")
    .innerJoin("user_tag as t", "a.tag_id", "t.id")
    .select([
      "a.id as assignmentId",
      "a.tag_id as tagId",
      "t.name as name",
      "t.description as description",
      "t.color as color",
      "a.expires_at as expiresAt",
    ])
    .where("a.uid", "=", uid)
    .orderBy("t.name", "asc")
    .execute();

  const now = new Date();
  return assignments.map((row) => ({
    assignmentId: Number(row.assignmentId),
    tagId: Number(row.tagId),
    name: row.name,
    description: row.description,
    color: row.color || "blue",
    expiresAt: row.expiresAt,
    isExpired: row.expiresAt ? new Date(row.expiresAt) < now : false,
  }));
}

/**
 * Assigns or refreshes a tag for a user.
 */
export async function assignUserTag(
  db: Kysely<DB>,
  {
    uid,
    tagId,
    expiresAt,
    assignedByUid,
  }: {
    uid: string;
    tagId: number;
    expiresAt?: string | null;
    assignedByUid?: string | null;
  }
): Promise<{ assignmentId: number | null; updated: boolean }> {
  const existing = await db
    .selectFrom("user_tag_assignment")
    .select(["id"])
    .where("uid", "=", uid)
    .where("tag_id", "=", tagId)
    .executeTakeFirst();

  if (existing && existing.id != null) {
    await db
      .updateTable("user_tag_assignment")
      .set({
        expires_at: expiresAt ?? null,
        assigned_by_uid: assignedByUid ?? null,
      })
      .where("id", "=", existing.id)
      .execute();
    return { assignmentId: Number(existing.id), updated: true };
  }

  const inserted = await db
    .insertInto("user_tag_assignment")
    .values({
      uid,
      tag_id: tagId,
      expires_at: expiresAt ?? null,
      assigned_by_uid: assignedByUid ?? null,
    })
    .returning(["id"])
    .executeTakeFirst();

  return { assignmentId: inserted?.id ? Number(inserted.id) : null, updated: false };
}

/**
 * Removes a user's tag assignment.
 */
export async function removeUserTag(
  db: Kysely<DB>,
  assignmentId: number
): Promise<void> {
  await db
    .deleteFrom("user_tag_assignment")
    .where("id", "=", assignmentId)
    .execute();
}

/**
 * Updates a tag assignment's expiration date.
 */
export async function updateTagExpiration(
  db: Kysely<DB>,
  assignmentId: number,
  expiresAt: string | null
): Promise<void> {
  await db
    .updateTable("user_tag_assignment")
    .set({ expires_at: expiresAt })
    .where("id", "=", assignmentId)
    .execute();
}

/**
 * Checks if a user has an active (unexpired) tag by name.
 */
export async function userHasActiveTag(
  db: Kysely<DB>,
  uid: string,
  tagName: string
): Promise<boolean> {
  const record = await db
    .selectFrom("user_tag_assignment as a")
    .innerJoin("user_tag as t", "a.tag_id", "t.id")
    .select(["a.id", "a.expires_at as expiresAt"])
    .where("a.uid", "=", uid)
    .where("t.name", "=", tagName)
    .executeTakeFirst();

  if (!record) return false;
  if (!record.expiresAt) return true;
  return new Date(record.expiresAt) > new Date();
}

/**
 * Returns a map of email -> tags for all pending invitations.
 */
export async function getInviteTagsMap(
  db: Kysely<DB>
): Promise<Map<string, UserTag[]>> {
  const rows = await db
    .selectFrom("user_invite_tag as it")
    .innerJoin("user_tag as t", "it.tag_id", "t.id")
    .select([
      "it.email as email",
      "t.id as id",
      "t.name as name",
      "t.description as description",
      "t.color as color",
    ])
    .orderBy("t.name", "asc")
    .execute();

  const map = new Map<string, UserTag[]>();
  for (const r of rows) {
    const emailKey = r.email.trim().toLowerCase();
    const existing = map.get(emailKey) || [];
    existing.push({
      id: Number(r.id),
      name: r.name,
      description: r.description,
      color: r.color || "blue",
    });
    map.set(emailKey, existing);
  }
  return map;
}

/**
 * Associates tags with an invited email address.
 */
export async function addInviteTags(
  db: Kysely<DB>,
  email: string,
  tagIds: number[],
  expiresAt?: string | null
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  for (const tagId of tagIds) {
    await db
      .insertInto("user_invite_tag")
      .values({
        email: normalized,
        tag_id: tagId,
        expires_at: expiresAt ?? null,
      })
      .execute();
  }
}

/**
 * Copies tags from user_invite_tag into user_tag_assignment for a newly provisioned user.
 */
export async function applyInviteTagsToUser(
  db: Kysely<DB>,
  email: string,
  uid: string,
  assignedByUid?: string | null
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const inviteTags = await db
    .selectFrom("user_invite_tag")
    .select(["tag_id", "expires_at as expiresAt"])
    .where("email", "=", normalized)
    .execute();

  for (const it of inviteTags) {
    await assignUserTag(db, {
      uid,
      tagId: Number(it.tag_id),
      expiresAt: it.expiresAt,
      assignedByUid: assignedByUid ?? null,
    });
  }
}
