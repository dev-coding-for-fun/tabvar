// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createRouteArgs,
  createUser,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  sendLoginEmail: vi.fn(),
  verifyAuthCode: vi.fn(),
  findOrCreateEmailUser: vi.fn(),
  createUserSession: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  sendLoginEmail: mocks.sendLoginEmail,
  verifyAuthCode: mocks.verifyAuthCode,
  findOrCreateEmailUser: mocks.findOrCreateEmailUser,
  createUserSession: mocks.createUserSession,
}));

import { action, loader } from "./login";

describe("login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loader", () => {
    it("returns decoded error messages from query params", async () => {
      const response = await loader(
        createRouteArgs({
          request: createGetRequest("https://example.com/login?error=invalid_token"),
          context: createContext(),
          params: {},
        })
      );

      expect(response.error).toContain("invalid or has expired");
    });

    it("returns null when no error query param is present", async () => {
      const response = await loader(
        createRouteArgs({
          request: createGetRequest("https://example.com/login"),
          context: createContext(),
          params: {},
        })
      );

      expect(response.error).toBeNull();
    });
  });

  describe("action", () => {
    it("rejects send-code when email is invalid", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/login", {
            intent: "send-code",
            email: "invalid-email",
          }),
          context: createContext(),
          params: {},
        })
      );

      const data = await readJson(response);
      expect(data.error).toContain("valid email");
      expect(data.step).toBe("email");
    });

    it("handles send-code successfully and advances to verify step", async () => {
      mocks.sendLoginEmail.mockResolvedValue({ success: true });

      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/login", {
            intent: "send-code",
            email: "climber@example.com",
          }),
          context: createContext(),
          params: {},
        })
      );

      const data = await readJson(response);
      expect(data.success).toBe(true);
      expect(data.step).toBe("verify");
      expect(data.email).toBe("climber@example.com");
      expect(mocks.sendLoginEmail).toHaveBeenCalledWith(expect.anything(), "climber@example.com");
    });

    it("returns error on send-code failure", async () => {
      mocks.sendLoginEmail.mockResolvedValue({ success: false, error: "Please wait 60 seconds" });

      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/login", {
            intent: "send-code",
            email: "climber@example.com",
          }),
          context: createContext(),
          params: {},
        })
      );

      const data = await readJson(response);
      expect(data.error).toContain("Please wait 60 seconds");
    });

    it("rejects verify-code when code is missing", async () => {
      const response = await action(
        createRouteArgs({
          request: createFormRequest("https://example.com/login", {
            intent: "verify-code",
            email: "climber@example.com",
            code: "",
          }),
          context: createContext(),
          params: {},
        })
      );

      const data = await readJson(response);
      expect(data.error).toContain("6-digit code");
    });

    it("verifies code successfully and establishes session", async () => {
      const user = createUser({ uid: "user-1", email: "climber@example.com" });
      mocks.verifyAuthCode.mockResolvedValue({ success: true });
      mocks.findOrCreateEmailUser.mockResolvedValue(user);
      mocks.createUserSession.mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: "/topos" } })
      );

      const request = createFormRequest("https://example.com/login", {
        intent: "verify-code",
        email: "climber@example.com",
        code: "123456",
      });

      const response = await action(
        createRouteArgs({
          request,
          context: createContext(),
          params: {},
        })
      );

      expect(mocks.verifyAuthCode).toHaveBeenCalledWith(expect.anything(), "climber@example.com", "123456");
      expect(mocks.findOrCreateEmailUser).toHaveBeenCalledWith(expect.anything(), "climber@example.com");
      expect(mocks.createUserSession).toHaveBeenCalledWith(
        request,
        expect.anything(),
        user,
        "/topos"
      );
    });
  });
});
