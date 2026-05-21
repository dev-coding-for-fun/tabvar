// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createContext, createGetRequest, createUser } from "~/test/helpers";
import { createUserSession, logout, requireUser } from "./auth.server";

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("Set-Cookie") ?? ""];
}

function sessionCookieFrom(response: Response) {
  const setCookie = setCookieHeaders(response).join(", ");
  const match = setCookie.match(/_session=[^;]+/);

  if (!match) {
    throw new Error("Session cookie was not set");
  }

  return match[0];
}

describe("auth.server session helpers", () => {
  it("creates a session and redirects to the requested path", async () => {
    const response = await createUserSession(
      createGetRequest("https://example.com/login"),
      createContext(),
      createUser({ uid: "user-1" }),
      "/topos"
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/topos");
    expect(setCookieHeaders(response).join(", ")).toContain("_session=");
    expect(setCookieHeaders(response).join(", ")).toContain("redirectTo=;");
  });

  it("redirects unauthenticated users to login with the current path", async () => {
    await expect(
      requireUser(createGetRequest("https://example.com/private?x=1"), createContext())
    ).rejects.toMatchObject({
      status: 302,
    });
  });

  it("returns the session user when a valid cookie is present", async () => {
    const context = createContext();
    const user = createUser({ uid: "user-1", role: "admin" });
    const loginResponse = await createUserSession(
      createGetRequest("https://example.com/login"),
      context,
      user,
      "/"
    );

    const request = new Request("https://example.com/private", {
      headers: { Cookie: sessionCookieFrom(loginResponse) },
    });

    await expect(requireUser(request, context)).resolves.toMatchObject({
      uid: "user-1",
      role: "admin",
    });
  });

  it("destroys the session on logout", async () => {
    const context = createContext();
    const loginResponse = await createUserSession(
      createGetRequest("https://example.com/login"),
      context,
      createUser(),
      "/"
    );
    const request = new Request("https://example.com/logout", {
      method: "POST",
      headers: { Cookie: sessionCookieFrom(loginResponse) },
    });

    const response = await logout(request, context);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(setCookieHeaders(response).join(", ")).toContain("_session=;");
    expect(setCookieHeaders(response).join(", ")).toContain("Expires=Thu, 01 Jan 1970");
  });
});
