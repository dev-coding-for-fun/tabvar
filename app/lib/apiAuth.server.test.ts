// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { isAllowedOrigin, requireApiToken, requireApiTokenUser } from "./apiAuth.server";

function bearerRequest(token?: string) {
  return new Request("https://example.com/api/v1/issues", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("requireApiToken (client-agnostic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid token from any client and returns its client", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: "tok-1", uid: "user-9", client: "someclient" } }],
      update: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const result = await requireApiToken(bearerRequest("anytoken"), createContext());

    expect(result).toEqual({ tokenId: "tok-1", uid: "user-9", client: "someclient" });
    // No client filter should be applied unless requested.
    expect(db.__queries[0].where).not.toHaveBeenCalledWith("client", "=", expect.anything());
    expect(db.updateTable).toHaveBeenCalledWith("api_token");
  });

  it("applies a client filter when one is provided", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: "tok-1", uid: "user-9", client: "topobuilder" } }],
      update: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    await requireApiToken(bearerRequest("anytoken"), createContext(), undefined, "topobuilder");

    expect(db.__queries[0].where).toHaveBeenCalledWith("client", "=", "topobuilder");
  });

  it("rejects a missing bearer token", async () => {
    const response = (await requireApiToken(bearerRequest(), createContext()).catch((e) => e)) as Response;
    expect(response.status).toBe(401);
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("rejects an unknown bearer token", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await requireApiToken(bearerRequest("bad"), createContext()).catch((e) => e)) as Response;
    expect(response.status).toBe(401);
  });
});

describe("requireApiTokenUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the linked user's role and display name", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: "tok-1", uid: "user-9", client: "topobuilder" } },
        { executeTakeFirst: { role: "admin", display_name: "Ada" } },
      ],
      update: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const result = await requireApiTokenUser(bearerRequest("anytoken"), createContext());

    expect(result).toEqual({
      tokenId: "tok-1",
      uid: "user-9",
      client: "topobuilder",
      role: "admin",
      displayName: "Ada",
    });
  });
});

describe("isAllowedOrigin", () => {
  it("allows the native client scheme and dev origins, rejects arbitrary URLs", () => {
    expect(isAllowedOrigin("topobuilder://tabvar-connect", createContext())).toBe(true);
    expect(isAllowedOrigin("http://localhost:8081", createContext())).toBe(true);
    expect(isAllowedOrigin("https://evil.example.com", createContext())).toBe(false);
  });
});
