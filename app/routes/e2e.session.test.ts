// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createMockDb,
  createRouteArgs,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  createUserSession: vi.fn(),
  assignUserTag: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ getDB: mocks.getDB }));
vi.mock("~/lib/auth.server", () => ({ createUserSession: mocks.createUserSession }));
vi.mock("~/lib/tags.server", () => ({ assignUserTag: mocks.assignUserTag }));

import { action } from "./e2e.session";

const sessionResponse = new Response(null, { status: 302, headers: { Location: "/" } });

function callAction(
  body: unknown,
  { url = "http://127.0.0.1:5173/e2e/session", environment = "dev" } = {}
) {
  return action(
    createRouteArgs({
      request: new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      context: createContext({ ENVIRONMENT: environment }),
      params: {},
    })
  );
}

const validBody = {
  email: "Admin@E2E.test",
  displayName: "E2E Admin",
  role: "admin",
};

async function expectNotFound(promise: Promise<unknown>) {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(Response);
  expect((thrown as Response).status).toBe(404);
}

describe("e2e.session action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUserSession.mockResolvedValue(sessionResponse);
  });

  it("is not found outside the dev environment", async () => {
    await expectNotFound(callAction(validBody, { environment: "production" }));
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("is not found on a non-loopback host even in dev", async () => {
    await expectNotFound(callAction(validBody, { url: "https://app.tabvar.org/e2e/session" }));
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("rejects emails outside the reserved e2e domain", async () => {
    const response = await callAction({ ...validBody, email: "real.person@gmail.com" });

    expect(getStatus(response)).toBe(400);
    expect((await readJson(response)).error).toContain("@e2e.test");
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("rejects unknown roles", async () => {
    const response = await callAction({ ...validBody, role: "owner" });

    expect(getStatus(response)).toBe(400);
    expect((await readJson(response)).error).toContain("role must be one of");
  });

  it("rejects unknown tags without touching the user", async () => {
    const db = createMockDb({
      select: [{ execute: [{ id: 3, name: "supporter_prog_manager" }] }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await callAction({
      ...validBody,
      tags: ["supporter_prog_manager", "typo_tag"],
    });

    expect(getStatus(response)).toBe(400);
    expect((await readJson(response)).error).toBe("Unknown user tags: typo_tag");
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
  });

  it("creates a new user with the requested role and tags, then signs it in", async () => {
    const user = createUser({ uid: "new-uid", email: "admin@e2e.test", role: "admin" });
    const db = createMockDb({
      select: [
        { execute: [{ id: 3, name: "supporter_prog_manager" }] },
        { executeTakeFirst: undefined },
        { executeTakeFirstOrThrow: user },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await callAction({ ...validBody, tags: ["supporter_prog_manager"] });

    expect(response).toBe(sessionResponse);
    const insert = db.insertInto.mock.results[0].value;
    expect(insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "admin@e2e.test",
        display_name: "E2E Admin",
        role: "admin",
        provider_id: "email",
        disclaimer_ack_date: expect.any(String),
      })
    );

    const staleTags = db.deleteFrom.mock.results[0].value;
    expect(db.deleteFrom).toHaveBeenCalledWith("user_tag_assignment");
    expect(staleTags.where).toHaveBeenCalledWith("uid", "=", "new-uid");
    expect(staleTags.where).toHaveBeenCalledWith("tag_id", "not in", [3]);
    expect(mocks.assignUserTag).toHaveBeenCalledWith(db, { uid: "new-uid", tagId: 3 });

    expect(mocks.createUserSession).toHaveBeenCalledWith(
      expect.any(Request),
      expect.anything(),
      user,
      "/"
    );
  });

  it("resets an existing user to the requested state and clears all tags when none are given", async () => {
    const user = createUser({ uid: "existing-uid", email: "guest-ish@e2e.test", role: "anonymous" });
    const db = createMockDb({
      select: [{ executeTakeFirst: { uid: "existing-uid" } }, { executeTakeFirstOrThrow: user }],
    });
    mocks.getDB.mockReturnValue(db);

    await callAction({
      email: "guest-ish@e2e.test",
      displayName: "E2E Signed-in Anonymous",
      role: "anonymous",
      disclaimerAcknowledged: false,
    });

    expect(db.insertInto).not.toHaveBeenCalled();
    const update = db.updateTable.mock.results[0].value;
    expect(update.set).toHaveBeenCalledWith({
      display_name: "E2E Signed-in Anonymous",
      role: "anonymous",
      email_verified: 1,
      disclaimer_ack_date: null,
    });
    expect(update.where).toHaveBeenCalledWith("uid", "=", "existing-uid");

    const staleTags = db.deleteFrom.mock.results[0].value;
    expect(staleTags.where).toHaveBeenCalledTimes(1);
    expect(mocks.assignUserTag).not.toHaveBeenCalled();
  });
});
