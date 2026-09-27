// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createRouteArgs, createUser } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getAuthenticator: vi.fn(),
  createUserSession: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  getAuthenticator: mocks.getAuthenticator,
  createUserSession: mocks.createUserSession,
}));

import { loader } from "./auth.google.callback";

describe("auth.google.callback loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticator.mockReturnValue({ authenticate: mocks.authenticate });
  });

  it("redirects to an absolute same-domain URL from the cookie", async () => {
    const user = createUser({ uid: "user-1" });
    mocks.authenticate.mockResolvedValue(user);
    mocks.createUserSession.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "https://app.tabvar.org/issues" } })
    );

    const request = new Request("https://example.com/auth/google/callback", {
      headers: { Cookie: `redirectTo=${encodeURIComponent("https://app.tabvar.org/issues")}` },
    });

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

  it("falls back to /topos when the cookie redirectTo is off-domain", async () => {
    const user = createUser({ uid: "user-1" });
    mocks.authenticate.mockResolvedValue(user);
    mocks.createUserSession.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "/topos" } })
    );

    const request = new Request("https://example.com/auth/google/callback", {
      headers: { Cookie: `redirectTo=${encodeURIComponent("https://evil.com/phish")}` },
    });

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
