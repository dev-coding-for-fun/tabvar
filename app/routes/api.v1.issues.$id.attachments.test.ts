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

vi.mock("~/lib/s3.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/s3.server")>()),
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
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "rep-1" } },
        { execute: [] },
        { executeTakeFirst: undefined },
      ],
      insert: [{ executeTakeFirstOrThrow: { id: 5 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
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
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "someone-else" } },
        { execute: [] },
        { executeTakeFirst: undefined },
      ],
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
      expect.objectContaining({ useContentHash: true }),
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

  it("returns existing attachment idempotently when the photo was already uploaded to this issue", async () => {
    const photoHash = "bb1f3308adcc035cb700962e4004e5e85c3cd006";
    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "u1" } },
        {
          execute: [
            {
              id: 10,
              name: "bolt.jpg",
              url: "https://issues.example.com/issues/existing.jpg",
              type: "image/jpeg",
              file_hash: photoHash,
            },
          ],
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({
      id: 10,
      url: "https://issues.example.com/issues/existing.jpg",
      hash: photoHash,
    });
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it("deduplicates identical files within the same request batch", async () => {
    const file1 = new File(["photo-bytes"], "bolt.jpg", { type: "image/jpeg" });
    const file2 = new File(["photo-bytes"], "bolt-copy.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("photos", file1);
    formData.append("photos", file2);

    const request = new Request("https://example.com/api/v1/issues/1/attachments", {
      method: "POST",
      body: formData,
    });

    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "u1" } },
        { execute: [] },
        { executeTakeFirst: undefined },
      ],
      insert: [{ executeTakeFirstOrThrow: { id: 42 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request,
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.attachments).toHaveLength(1);
    expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(1);
    expect(db.insertInto).toHaveBeenCalledTimes(1);
  });

  it("reuses existing R2 URL when photo exists globally on another issue", async () => {
    const existingUrl = "https://issues.example.com/issues/shared.jpg";
    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "u1" } },
        { execute: [] }, // no existing on this issue
        { executeTakeFirst: { url: existingUrl, type: "image/jpeg" } }, // exists globally
      ],
      insert: [{ executeTakeFirstOrThrow: { id: 77 } }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.attachments[0]).toMatchObject({ id: 77, url: existingUrl });
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    expect(db.insertInto).toHaveBeenCalledTimes(1);
  });

  it("rejects upload when adding new distinct files exceeds max files quota", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: 1, reported_by_uid: "u1" } },
        {
          execute: [
            { id: 1, file_hash: "hash-1" },
            { id: 2, file_hash: "hash-2" },
            { id: 3, file_hash: "hash-3" },
            { id: 4, file_hash: "hash-4" },
            { id: 5, file_hash: "hash-5" },
            { id: 6, file_hash: "hash-6" },
          ],
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = (await action(createRouteArgs({
      request: photoRequest(),
      context: createContext(),
      params: { id: "1" },
    }))) as Response;

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.message).toContain("maximum of 6 photos");
  });
});
