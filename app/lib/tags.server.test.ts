import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/helpers";
import {
  assignUserTag,
  getAllTags,
  getAllUserTagAssignmentsMap,
  getUserTags,
  removeUserTag,
  updateTagExpiration,
  userHasActiveTag,
} from "./tags.server";

describe("tags.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAllTags", () => {
    it("returns tags with their active assignment counts", async () => {
      const tags = [
        {
          id: 1,
          name: "Supporter",
          description: "Tier 1",
          color: "teal",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        {
          id: 2,
          name: "Patron",
          description: null,
          color: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ];
      const activeAssignments = [{ tag_id: 1, count: 5 }];
      const db = createMockDb({
        select: [{ execute: tags }, { execute: activeAssignments }],
      });

      const result = await getAllTags(db as any);
      expect(result).toEqual([
        {
          id: 1,
          name: "Supporter",
          description: "Tier 1",
          color: "teal",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          activeCount: 5,
        },
        {
          id: 2,
          name: "Patron",
          description: null,
          color: "blue",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          activeCount: 0,
        },
      ]);
    });
  });

  describe("getAllUserTagAssignmentsMap", () => {
    it("groups tag assignments by user uid with isExpired status", async () => {
      const assignments = [
        {
          assignmentId: 101,
          uid: "user-1",
          tagId: 1,
          name: "Supporter",
          description: "Tier 1",
          color: "teal",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        {
          assignmentId: 102,
          uid: "user-1",
          tagId: 2,
          name: "Beta Tester",
          description: null,
          color: "orange",
          expiresAt: "2020-01-01T00:00:00.000Z", // expired
        },
      ];
      const db = createMockDb({
        select: [{ execute: assignments }],
      });

      const map = await getAllUserTagAssignmentsMap(db as any);
      const user1Tags = map.get("user-1");
      expect(user1Tags).toHaveLength(2);
      expect(user1Tags?.[0].isExpired).toBe(false);
      expect(user1Tags?.[1].isExpired).toBe(true);
    });
  });

  describe("getUserTags", () => {
    it("returns tags for a single user", async () => {
      const assignments = [
        {
          assignmentId: 101,
          tagId: 1,
          name: "Supporter",
          description: "Tier 1",
          color: "teal",
          expiresAt: null,
        },
      ];
      const db = createMockDb({
        select: [{ execute: assignments }],
      });

      const tags = await getUserTags(db as any, "user-1");
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        assignmentId: 101,
        tagId: 1,
        name: "Supporter",
        description: "Tier 1",
        color: "teal",
        expiresAt: null,
        isExpired: false,
      });
    });
  });

  describe("assignUserTag", () => {
    it("inserts a new assignment when none exists", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: undefined }],
        insert: [{ executeTakeFirst: { id: 77 } }],
      });

      const result = await assignUserTag(db as any, {
        uid: "user-1",
        tagId: 1,
        expiresAt: "2099-01-01",
        assignedByUid: "admin-1",
      });

      expect(result).toEqual({ assignmentId: 77, updated: false });
      expect(db.insertInto).toHaveBeenCalledWith("user_tag_assignment");
    });

    it("updates existing assignment when one exists", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 42 } }],
        update: [{ execute: undefined }],
      });

      const result = await assignUserTag(db as any, {
        uid: "user-1",
        tagId: 1,
        expiresAt: "2099-01-01",
        assignedByUid: "admin-1",
      });

      expect(result).toEqual({ assignmentId: 42, updated: true });
      expect(db.updateTable).toHaveBeenCalledWith("user_tag_assignment");
    });
  });

  describe("removeUserTag", () => {
    it("deletes the assignment by ID", async () => {
      const db = createMockDb({
        delete: [{ execute: undefined }],
      });

      await removeUserTag(db as any, 42);
      expect(db.deleteFrom).toHaveBeenCalledWith("user_tag_assignment");
    });
  });

  describe("updateTagExpiration", () => {
    it("updates the expiration date on the assignment", async () => {
      const db = createMockDb({
        update: [{ execute: undefined }],
      });

      await updateTagExpiration(db as any, 42, "2099-12-31");
      expect(db.updateTable).toHaveBeenCalledWith("user_tag_assignment");
    });
  });

  describe("userHasActiveTag", () => {
    it("returns false if user does not have tag", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: undefined }],
      });

      const result = await userHasActiveTag(db as any, "u-1", "Supporter");
      expect(result).toBe(false);
    });

    it("returns true if tag has no expiration", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 1, expiresAt: null } }],
      });

      const result = await userHasActiveTag(db as any, "u-1", "Supporter");
      expect(result).toBe(true);
    });

    it("returns true if expiration date is in the future", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 1, expiresAt: "2099-01-01T00:00:00Z" } }],
      });

      const result = await userHasActiveTag(db as any, "u-1", "Supporter");
      expect(result).toBe(true);
    });

    it("returns false if expiration date is in the past", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 1, expiresAt: "2020-01-01T00:00:00Z" } }],
      });

      const result = await userHasActiveTag(db as any, "u-1", "Supporter");
      expect(result).toBe(false);
    });
  });
});
