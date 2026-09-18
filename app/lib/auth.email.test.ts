// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb, createUser } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import {
  findOrCreateEmailUser,
  sendLoginEmail,
  verifyAuthCode,
  verifyMagicToken,
} from "./auth.server";

describe("auth.server passwordless email authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendLoginEmail", () => {
    it("rejects invalid email formats", async () => {
      const context = createContext();
      const result = await sendLoginEmail(context, "not-an-email");
      expect(result.success).toBe(false);
      expect(result.error).toContain("valid email");
    });

    it("enforces a 60-second rate limit cooldown", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 1 } }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await sendLoginEmail(context, "climber@example.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("60 seconds");
    });

    it("generates and dispatches login code and link when valid", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: undefined }],
        delete: [{ execute: undefined }],
        insert: [{ execute: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await sendLoginEmail(context, "climber@example.com");

      expect(result.success).toBe(true);
      expect(db.insertInto).toHaveBeenCalledWith("auth_token");
      expect(context.cloudflare.env.EMAIL?.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "climber@example.com",
          from: "auth@tabvar.org",
          subject: expect.stringContaining("Your TABVAR Login Code:"),
          text: expect.stringContaining("Your TABVAR login code is:"),
          html: expect.stringContaining("Sign in to TABVAR"),
        })
      );
    });
  });

  describe("verifyAuthCode", () => {
    it("returns error when token record is not found or expired", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyAuthCode(context, "climber@example.com", "123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("expired or not found");
    });

    it("rejects and deletes token when maximum attempts are exceeded", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 1, attempts: 5, code_hash: "hash" } }],
        delete: [{ execute: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyAuthCode(context, "climber@example.com", "123456");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Too many incorrect attempts");
      expect(db.deleteFrom).toHaveBeenCalledWith("auth_token");
    });

    it("increments attempts when the submitted code does not match", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 10, attempts: 1, code_hash: "expected-hash" } }],
        update: [{ execute: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyAuthCode(context, "climber@example.com", "000000");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid verification code");
      expect(db.updateTable).toHaveBeenCalledWith("auth_token");
    });

    it("verifies code successfully and deletes tokens on match", async () => {
      const encoder = new TextEncoder();
      const data = encoder.encode("654321");
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const codeHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 10, attempts: 0, code_hash: codeHash } }],
        delete: [{ execute: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyAuthCode(context, "climber@example.com", "654321");

      expect(result.success).toBe(true);
      expect(db.deleteFrom).toHaveBeenCalledWith("auth_token");
    });
  });

  describe("verifyMagicToken", () => {
    it("returns error when magic token is not found or expired", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyMagicToken(context, "invalid-token");

      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid or has expired");
    });

    it("verifies magic token, deletes tokens and returns email", async () => {
      const db = createMockDb({
        select: [{ executeTakeFirst: { id: 5, email: "climber@example.com" } }],
        delete: [{ execute: undefined }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const result = await verifyMagicToken(context, "valid-token");

      expect(result.success).toBe(true);
      expect(result.email).toBe("climber@example.com");
      expect(db.deleteFrom).toHaveBeenCalledWith("auth_token");
    });
  });

  describe("findOrCreateEmailUser", () => {
    it("links to existing user if email is already in database", async () => {
      const existingUser = createUser({
        uid: "existing-google-user",
        email: "climber@example.com",
        role: "admin",
        emailVerified: true,
      });

      const db = createMockDb({
        select: [{ executeTakeFirst: existingUser }],
        insert: [{ executeTakeFirst: { signin_id: 1, uid: "existing-google-user" } }],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const user = await findOrCreateEmailUser(context, "climber@example.com");

      expect(user.uid).toBe("existing-google-user");
      expect(user.role).toBe("admin");
      expect(db.insertInto).toHaveBeenCalledWith("signin_event");
    });

    it("creates a new user with invited role when an invite is present", async () => {
      const createdUser = createUser({
        uid: "new-email-user",
        email: "invited@example.com",
        role: "route_editor",
        providerId: "email",
      });

      const db = createMockDb({
        select: [
          { executeTakeFirst: undefined },
          { executeTakeFirst: { email: "invited@example.com", role: "route_editor" } },
        ],
        insert: [
          { executeTakeFirstOrThrow: createdUser },
          { executeTakeFirst: { signin_id: 1, uid: "new-email-user" } },
        ],
      });
      mocks.getDB.mockReturnValue(db);

      const context = createContext();
      const user = await findOrCreateEmailUser(context, "invited@example.com");

      expect(user.role).toBe("route_editor");
      expect(db.insertInto).toHaveBeenCalledWith("user");
      expect(db.insertInto).toHaveBeenCalledWith("signin_event");
    });
  });
});
