// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "react-router";
import { createContext, createGetRequest, createMockDb, createRouteArgs, createUser, getStatus, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

import { loader } from "./connect.topobuilder";

describe("connect.topobuilder loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid callback URLs", async () => {
    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/connect/topobuilder?return_to=https%3A%2F%2Fevil.example.com%2Fcallback"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    await expect(readJson(response)).resolves.toBe("Invalid TopoBuilder callback URL.");
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("uses the existing login redirect when the user is not signed in", async () => {
    const loginRedirect = redirect("/login?redirectTo=%2Fconnect%2Ftopobuilder");
    mocks.requireUser.mockRejectedValue(loginRedirect);

    await expect(loader(createRouteArgs({
      request: createGetRequest("https://example.com/connect/topobuilder?return_to=topobuilder%3A%2F%2Ftabvar-connect"),
      context: createContext(),
      params: {},
    }))).rejects.toBe(loginRedirect);
  });

  it("creates a ticket and redirects back to TopoBuilder", async () => {
    const db = createMockDb({ insert: [{ execute: [] }] });
    mocks.getDB.mockReturnValue(db);
    mocks.requireUser.mockResolvedValue(createUser({ uid: "user-123" }));

    let response: Response | null = null;
    try {
      await loader(createRouteArgs({
        request: createGetRequest("https://example.com/connect/topobuilder?return_to=topobuilder%3A%2F%2Ftabvar-connect%3Fsource%3Dsettings"),
        context: createContext(),
        params: {},
      }));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    const location = response?.headers.get("Location");
    expect(location).toContain("topobuilder://tabvar-connect?source=settings&ticket=tb_ticket_");
    expect(db.insertInto).toHaveBeenCalledWith("topobuilder_connect_ticket");
    expect(db.__queries[0].values).toHaveBeenCalledWith(expect.objectContaining({
      uid: "user-123",
      return_to: "topobuilder://tabvar-connect?source=settings",
      ticket_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expires_at: expect.any(String),
    }));
  });
});
