// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createMockDb, createUser } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  googleUserProfile: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("@coji/remix-auth-google", () => {
  class GoogleStrategy {
    static userProfile = mocks.googleUserProfile;
    name = "google";

    private verify: (args: { tokens: { accessToken: string } }) => Promise<unknown>;

    constructor(
      _options: unknown,
      verify: (args: { tokens: { accessToken: string } }) => Promise<unknown>
    ) {
      this.verify = verify;
    }

    async authenticate() {
      return this.verify({ tokens: { accessToken: "test-access-token" } });
    }
  }

  return { GoogleStrategy };
});

import { createUserSession, getAuthenticator, logout, requireUser } from "./auth.server";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe("auth.server Google account creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new Google user with the invited role", async () => {
    const insertedUser = createUser({
      uid: "google-user-1",
      email: "new-user@example.com",
      displayName: "New User",
      avatarUrl: "https://example.com/avatar.jpg",
      role: "member",
    });
    const db = createMockDb({
      select: [
        { executeTakeFirst: undefined },
        { executeTakeFirst: { email: "new-user@example.com", role: "member" } },
      ],
      insert: [
        { executeTakeFirstOrThrow: insertedUser },
        { executeTakeFirst: { signin_id: 1, uid: "google-user-1" } },
      ],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.googleUserProfile.mockResolvedValue({
      id: "google-user-1",
      displayName: "New User",
      emails: [{ value: "new-user@example.com" }],
      photos: [{ value: "https://example.com/avatar.jpg" }],
    });

    await expect(
      getAuthenticator(createContext()).authenticate("google", createGetRequest("https://example.com/auth/google/callback"))
    ).resolves.toEqual(insertedUser);

    expect(db.insertInto).toHaveBeenCalledWith("user");
    expect(db.__queries[2].values).toHaveBeenCalledWith({
      uid: "google-user-1",
      email: "new-user@example.com",
      display_name: "New User",
      email_verified: 1,
      provider_id: "google",
      avatar_url: "https://example.com/avatar.jpg",
      role: "member",
    });
    expect(db.insertInto).toHaveBeenCalledWith("signin_event");
  });

  it("creates a new Google user when Google does not provide a profile photo", async () => {
    const insertedUser = createUser({
      uid: "google-user-2",
      email: "photo-less@example.com",
      displayName: "Photo Less",
      avatarUrl: null,
      role: "anonymous",
    });
    const db = createMockDb({
      select: [
        { executeTakeFirst: undefined },
        { executeTakeFirst: undefined },
      ],
      insert: [
        { executeTakeFirstOrThrow: insertedUser },
        { executeTakeFirst: { signin_id: 2, uid: "google-user-2" } },
      ],
    });
    mocks.getDB.mockReturnValue(db);
    mocks.googleUserProfile.mockResolvedValue({
      id: "google-user-2",
      displayName: "Photo Less",
      emails: [{ value: "photo-less@example.com" }],
      photos: [],
    });

    await expect(
      getAuthenticator(createContext()).authenticate("google", createGetRequest("https://example.com/auth/google/callback"))
    ).resolves.toEqual(insertedUser);

    expect(db.__queries[2].values).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "google-user-2",
        email: "photo-less@example.com",
        avatar_url: null,
        role: "anonymous",
      })
    );
  });
});
