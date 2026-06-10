// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createFormRequest, createMockDb, createRouteArgs } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireApiTokenUser: vi.fn(),
  uploadFileToR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/s3.server", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
}));

vi.mock("~/lib/apiAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apiAuth.server")>()),
  requireApiTokenUser: mocks.requireApiTokenUser,
}));

import { action } from "./api.v1.issues.$id.attachments";

function tokenUser(overrides: Record<string, unknown> = {}) {
  return { tokenId: "t1", uid: "u1", client: "topobuilder", role: "member", displayName: "Mod", ...overrides };
}

function photoRequest() {
  const file = new File(["photo-bytes"], "bolt.jpg", { type: "image/jpeg" });
  return createFormRequest("https://example.com/api/v1/issues/1/attachments", { photos: file });
}

describe("api.v1.issues.$id.attachments action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser());
    mocks.uploadFileToR2.mockResolvedValue({
      name: "bolt.jpg",
      type: "image/jpeg",
      url: "https://issues.example.com/bolt.jpg",
    });
  });

  it("lets an anonymous user upload to an issue they reported", async () => {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: null, uid: "rep-1" }));
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 1, reported_by_uid: "rep-1" } }],
      insert: [{ executeTakeFirstOrThrow: { id: 5 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ id: 5, url: "https://issues.example.com/bolt.jpg" });
  });

  it("forbids an anonymous user from uploading to someone else's issue", async () => {
    mocks.requireApiTokenUser.mockResolvedValue(tokenUser({ role: null, uid: "other" }));
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 1, reported_by_uid: "rep-1" } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(403);
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
  });

  it("lets a moderator upload to any issue", async () => {
    const db = createMockDb({
      select: [{ executeTakeFirst: { id: 1, reported_by_uid: "someone-else" } }],
      insert: [{ executeTakeFirstOrThrow: { id: 9 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(201);
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "bolt.jpg" }),
      "issues",
      "https://issues.example.com",
    );
  });

  it("returns 404 when the issue does not exist", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(404);
  });
});
