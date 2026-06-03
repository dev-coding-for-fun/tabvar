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
      select: [{ executeTakeFirst: { id: "token-1", revokedAt: null } }],
      update: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: disconnectRequest("tb_token_valid"),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(db.updateTable).toHaveBeenCalledWith("api_token");
    expect(db.__queries[1].set).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
  });

  it("treats an already revoked token as disconnected", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: "token-1", revokedAt: "2026-01-01T00:00:00.000Z" } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: disconnectRequest("tb_token_valid"),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it("rejects missing bearer tokens", async () => {
    const response = await action(createRouteArgs({
      request: disconnectRequest(),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("rejects unknown bearer tokens", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: disconnectRequest("tb_token_unknown"),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
  });
});
