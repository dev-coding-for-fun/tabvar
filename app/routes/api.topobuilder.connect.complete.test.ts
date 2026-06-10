// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createMockDb, createRouteArgs } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

import { action } from "./api.topobuilder.connect.complete";

function jsonRequest(body: unknown, origin = "http://localhost:8081") {
  return new Request("https://example.com/api/topobuilder/connect/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

describe("api.topobuilder.connect.complete action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges a valid ticket for a durable token", async () => {
    const db = createMockDb({
      select: [{
        executeTakeFirst: {
          ticketId: "ticket-1",
          uid: "user-1",
          displayName: "Test User",
          email: "user@example.com",
          role: "member",
        },
      }],
      update: [{ execute: [] }],
      insert: [{ execute: [] }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: jsonRequest({ ticket: "tb_ticket_valid" }),
      context: createContext(),
      params: {},
    })) as Response;
    const body = await response.json() as { token: string; user: unknown };

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
    expect(body.token).toMatch(/^tb_token_/);
    expect(body.user).toEqual({
      uid: "user-1",
      displayName: "Test User",
      email: "user@example.com",
      role: "member",
    });
    expect(db.updateTable).toHaveBeenCalledWith("topobuilder_connect_ticket");
    expect(db.insertInto).toHaveBeenCalledWith("api_token");
    expect(db.__queries[2].values).toHaveBeenCalledWith(expect.objectContaining({
      uid: "user-1",
      client: "topobuilder",
      name: "TopoBuilder",
      token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("rejects missing tickets", async () => {
    const response = await action(createRouteArgs({
      request: jsonRequest({}),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired tickets", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = await action(createRouteArgs({
      request: jsonRequest({ ticket: "tb_ticket_expired" }),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_ticket" });
  });

  it("handles CORS preflight", async () => {
    const response = await action(createRouteArgs({
      request: new Request("https://example.com/api/topobuilder/connect/complete", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:8081" },
      }),
      context: createContext(),
      params: {},
    })) as Response;

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });
});
