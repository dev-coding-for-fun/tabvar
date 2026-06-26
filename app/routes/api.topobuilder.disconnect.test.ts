// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb, createRouteArgs } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { action } from "./api.topobuilder.disconnect";

function disconnectRequest(token?: string) {
  return new Request("https://example.com/api/topobuilder/disconnect", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: "http://localhost:8081",
    },
  });
}

describe("api.topobuilder.disconnect action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes a valid token", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: "token-1", uid: "user-1", client: "topobuilder" } }],
      update: [{ execute: [] }, { execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: disconnectRequest("tb_token_valid"),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(db.updateTable).toHaveBeenCalledTimes(2);
    expect(db.__queries[1].set).toHaveBeenCalledWith({ last_used_at: expect.any(String) });
    expect(db.__queries[2].set).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
  });

  it("rejects an already revoked token", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: disconnectRequest("tb_token_valid"),
      context: createContext(),
      params: {},
    })).catch((error) => error)) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it("rejects missing bearer tokens", async () => {
    const response = (await action(createRouteArgs({
      request: disconnectRequest(),
      context: createContext(),
      params: {},
    })).catch((error) => error)) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
  });

  it("rejects unknown bearer tokens", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: disconnectRequest("tb_token_unknown"),
      context: createContext(),
      params: {},
    })).catch((error) => error)) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
  });
});
