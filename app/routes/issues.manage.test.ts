import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createMockDb,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  deleteFromR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/s3.server", () => ({
  deleteFromR2: mocks.deleteFromR2,
}));

vi.mock("~/components/issueDetailModal", () => ({
  default: () => null,
}));

import { action } from "./issues.manage";

const existingIssue = {
  id: 10,
  issue_type: "Bolts",
  sub_issue_type: "Loose bolt",
  description: "Spinner",
  is_flagged: 0,
  flagged_message: null,
  bolts_affected: "2",
  route_id: 99,
  status: "Reported",
};

describe("issues.manage action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for users outside moderation roles", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "anonymous" }));

    const response = await action({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "accept",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    });

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toMatchObject({
      error: "You do not have the required permissions to access this page.",
    });
  });

  it.each([
    ["accept", "Reported", "Issue accepted"],
    ["archive", "Archived", "Issue archived"],
    ["complete", "Completed", "Issue marked as complete"],
    ["revert", "Reported", "Issue reverted"],
    ["restore", "Viewed", "Issue restored"],
  ])("updates issue status for %s", async (actionName, expectedStatus, expectedMessage) => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member", uid: "mod-1" }));
    const db = createMockDb({
      select: [{ executeTakeFirstOrThrow: existingIssue }],
      update: [{ execute: undefined }],
      insert: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action({
      request: createFormRequest("https://example.com/issues/manage", {
        action: actionName,
        issueId: "10",
        status: "Reported",
        lastStatus: "Viewed",
      }),
      context: createContext(),
      params: {},
    });

    expect(getStatus(response)).toBe(200);
    expect(await readJson(response)).toMatchObject({
      success: true,
      message: expectedMessage,
    });
    expect(db.updateTable).toHaveBeenCalledWith("issue");
    expect(db.__queries[1].set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expectedStatus,
        last_status: "Reported",
      })
    );
    expect(db.insertInto).toHaveBeenCalledWith("issue_audit_log");
  });

  it("keeps the current claim action gap visible", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "claim",
        issueId: "10",
        status: "Reported",
      }),
      context: createContext(),
      params: {},
    });

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      message: "Invalid action",
    });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("requires admin role for permanent delete", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "delete",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    });

    expect(getStatus(response)).toBe(403);
    expect(await readJson(response)).toMatchObject({
      success: false,
      message: "Admin role required to permanently delete issues",
    });
  });

  it("permanently deletes an issue for admins", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin", uid: "admin-1" }));
    const db = createMockDb({
      select: [
        { executeTakeFirstOrThrow: existingIssue },
        { execute: [{ url: "https://issues.example.com/bolt.jpg", name: "bolt.jpg" }] },
      ],
      delete: [{ execute: undefined }, { execute: undefined }, { execute: undefined }],
      insert: [{ execute: undefined }],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await action({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "delete",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    });

    expect(getStatus(response)).toBe(200);
    expect(await readJson(response)).toMatchObject({
      success: true,
      message: "Issue permanently deleted",
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(expect.anything(), "issues", "bolt.jpg");
    expect(db.deleteFrom).toHaveBeenCalledWith("issue_attachment");
    expect(db.deleteFrom).toHaveBeenCalledWith("external_issue_ref");
    expect(db.deleteFrom).toHaveBeenCalledWith("issue");
    expect(db.insertInto).toHaveBeenCalledWith("issue_audit_log");
  });
});
