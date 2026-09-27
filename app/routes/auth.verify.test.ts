// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createRouteArgs, createUser } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  verifyMagicToken: vi.fn(),
  findOrCreateEmailUser: vi.fn(),
  createUserSession: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  verifyMagicToken: mocks.verifyMagicToken,
  findOrCreateEmailUser: mocks.findOrCreateEmailUser,
  createUserSession: mocks.createUserSession,
}));

import { loader } from "./auth.verify";

describe("auth.verify loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when token parameter is missing", async () => {
    const response = await loader(
      createRouteArgs({
        request: createGetRequest("https://example.com/auth/verify"),
        context: createContext(),
        params: {},
      })
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe("/login?error=missing_token");
  });

  it("redirects to login with error when token verification fails", async () => {
    mocks.verifyMagicToken.mockResolvedValue({
      success: false,
      error: "Login link is invalid or has expired.",
    });

    const response = await loader(
      createRouteArgs({
        request: createGetRequest("https://example.com/auth/verify?token=expired-tok"),
        context: createContext(),
        params: {},
      })
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toContain("/login?error=");
  });

  it("verifies token, finds user, and calls createUserSession", async () => {
    const user = createUser({ uid: "user-123", email: "climber@example.com" });
    mocks.verifyMagicToken.mockResolvedValue({
      success: true,
      email: "climber@example.com",
    });
    mocks.findOrCreateEmailUser.mockResolvedValue(user);
    mocks.createUserSession.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "/topos" } })
    );

    const request = new Request("https://example.com/auth/verify?token=valid-tok", {
      headers: { Cookie: "redirectTo=%2Fissues" },
    });

    const response = await loader(
      createRouteArgs({
        request,
        context: createContext(),
        params: {},
      })
    );

    expect(mocks.verifyMagicToken).toHaveBeenCalledWith(expect.anything(), "valid-tok");
    expect(mocks.findOrCreateEmailUser).toHaveBeenCalledWith(expect.anything(), "climber@example.com");
    expect(mocks.createUserSession).toHaveBeenCalledWith(
      request,
      expect.anything(),
      user,
      "/issues"
    );
    expect((response as Response).headers.get("Location")).toBe("/topos");
  });

  it("passes absolute same-domain redirectTo through to createUserSession", async () => {
    const user = createUser({ uid: "user-123", email: "climber@example.com" });
    mocks.verifyMagicToken.mockResolvedValue({
      success: true,
      email: "climber@example.com",
    });
    mocks.findOrCreateEmailUser.mockResolvedValue(user);
    mocks.createUserSession.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "https://app.tabvar.org/issues" } })
    );

    const request = createGetRequest(
      `https://example.com/auth/verify?token=valid-tok&redirectTo=${encodeURIComponent("https://app.tabvar.org/issues")}`
    );

    await loader(
      createRouteArgs({
        request,
        context: createContext(),
        params: {},
      })
    );

    expect(mocks.createUserSession).toHaveBeenCalledWith(
      request,
      expect.anything(),
      user,
      "https://app.tabvar.org/issues"
    );
  });

  it("falls back to /topos when redirectTo is off-domain", async () => {
    const user = createUser({ uid: "user-123", email: "climber@example.com" });
    mocks.verifyMagicToken.mockResolvedValue({
      success: true,
      email: "climber@example.com",
    });
    mocks.findOrCreateEmailUser.mockResolvedValue(user);
    mocks.createUserSession.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "/topos" } })
    );

    const request = createGetRequest(
      `https://example.com/auth/verify?token=valid-tok&redirectTo=${encodeURIComponent("https://evil.com/phish")}`
    );

    await loader(
      createRouteArgs({
        request,
        context: createContext(),
        params: {},
      })
    );

    expect(mocks.createUserSession).toHaveBeenCalledWith(
      request,
      expect.anything(),
      user,
      "/topos"
    );
  });
});
