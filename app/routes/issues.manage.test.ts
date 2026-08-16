import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createUser,
  getStatus,
  readJson,
  createRouteArgs,
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

import { action, issueMatchesSearch, issueMatchesStatusFilter, loader, submittedAttribution, workflowAuditEntries } from "./issues.manage";

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

describe("issues.manage loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));
  });

  it("attributes status history 'by' to the submitter, not the moderator who approved", async () => {
    const db = createMockDb({
      select: [
        {
          execute: [{
            id: 10,
            route_id: 99,
            route_name: "The Nose",
            sector_name: "El Cap",
            crag_name: "Yosemite",
            issue_type: "Bolts",
            sub_issue_type: "Loose bolt",
            status: "Reported",
            last_status: "In Moderation",
            description: "Spinner",
            is_flagged: 0,
            flagged_message: null,
            bolts_affected: "2",
            reported_by: "Alice Submitter",
            attachment_id: null,
            url: null,
            attachment_name: null,
            created_at: "2026-04-01T10:00:00.000Z",
          }],
        },
        {
          execute: [{
            issue_id: 10,
            before_status: "In Moderation",
            after_status: "Reported",
            timestamp: "2026-04-03T15:00:00.000Z",
            user_display_name: "Bob Moderator",
          }],
        },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/issues/manage"),
      context: createContext(),
      params: {},
    }));

    const payload = await readJson(response) as { issues: Array<{
      reportedBy: string | null;
      statusHistory: Array<{ status: string; userDisplayName: string | null }>;
    }> };
    expect(payload.issues).toHaveLength(1);
    expect(payload.issues[0].reportedBy).toBe("Alice Submitter");
    expect(payload.issues[0].statusHistory).toEqual([
      expect.objectContaining({
        status: "In Moderation",
        userDisplayName: "Alice Submitter",
      }),
      expect.objectContaining({
        status: "Reported",
        userDisplayName: "Bob Moderator",
      }),
    ]);
  });

  it("still attributes an unmoderated issue to the submitter when there is no audit history", async () => {
    const db = createMockDb({
      select: [
        {
          execute: [{
            id: 11,
            route_id: 99,
            route_name: "The Nose",
            sector_name: "El Cap",
            crag_name: "Yosemite",
            issue_type: "Bolts",
            sub_issue_type: "Loose bolt",
            status: "In Moderation",
            last_status: null,
            description: "Spinner",
            is_flagged: 0,
            flagged_message: null,
            bolts_affected: "2",
            reported_by: "Alice Submitter",
            attachment_id: null,
            url: null,
            attachment_name: null,
            created_at: "2026-04-01T10:00:00.000Z",
          }],
        },
        { execute: [] },
      ],
    });
    mocks.getDB.mockReturnValue(db);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/issues/manage"),
      context: createContext(),
      params: {},
    }));

    const payload = await readJson(response) as { issues: Array<{
      statusHistory: Array<{ status: string; userDisplayName: string | null }>;
    }> };
    expect(payload.issues[0].statusHistory).toEqual([
      expect.objectContaining({
        status: "In Moderation",
        userDisplayName: "Alice Submitter",
      }),
    ]);
  });
});

describe("issues.manage status attribution", () => {
  it("uses only the submitter for the table row, even if history starts with a moderator", () => {
    const issue = {
      createdAt: "2026-04-01T10:00:00.000Z",
      reportedBy: "Alice Submitter",
      statusHistory: [
        { status: "Reported", timestamp: "2026-04-03T15:00:00.000Z", userDisplayName: "Bob Moderator" },
      ],
    };

    expect(submittedAttribution(issue)).toEqual({
      status: "submitted",
      timestamp: "2026-04-01T10:00:00.000Z",
      userDisplayName: "Alice Submitter",
    });
    expect(submittedAttribution(issue).userDisplayName).not.toBe("Bob Moderator");
  });

  it("keeps approvers and later workflow actors in the audit trail only", () => {
    const history = [
      { status: "In Moderation", timestamp: "2026-04-01T10:00:00.000Z", userDisplayName: "Alice Submitter" },
      { status: "Reported", timestamp: "2026-04-03T15:00:00.000Z", userDisplayName: "Bob Moderator" },
      { status: "Completed", timestamp: "2026-04-10T12:00:00.000Z", userDisplayName: "Carol Completer" },
    ];

    expect(workflowAuditEntries(history)).toEqual([
      expect.objectContaining({ status: "Completed", userDisplayName: "Carol Completer" }),
      expect.objectContaining({ status: "Reported", userDisplayName: "Bob Moderator" }),
    ]);
    expect(workflowAuditEntries(history).map((entry) => entry.userDisplayName)).not.toContain("Alice Submitter");
  });
});

describe("issues.manage table filters", () => {
  const issue = {
    status: "Reported",
    route: { name: "The Nose", sectorName: "El Cap", cragName: "Yosemite" },
  };

  it("matches route, sector, or crag without waiting on a search request", () => {
    expect(issueMatchesSearch(issue, "nose")).toBe(true);
    expect(issueMatchesSearch(issue, "el cap")).toBe(true);
    expect(issueMatchesSearch(issue, "yosemite")).toBe(true);
    expect(issueMatchesSearch(issue, "nose yosemite")).toBe(true);
    expect(issueMatchesSearch(issue, "half dome")).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(issueMatchesSearch(issue, "  ")).toBe(true);
  });

  it("hides archived issues from the All status filter", () => {
    expect(issueMatchesStatusFilter({ status: "Reported" }, "All")).toBe(true);
    expect(issueMatchesStatusFilter({ status: "Archived" }, "All")).toBe(false);
    expect(issueMatchesStatusFilter({ status: "Archived" }, "Archived")).toBe(true);
    expect(issueMatchesStatusFilter({ status: "Viewed" }, "Public")).toBe(true);
    expect(issueMatchesStatusFilter({ status: "Completed" }, "Complete")).toBe(true);
  });
});

describe("issues.manage action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for users outside moderation roles", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "anonymous" }));

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "accept",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    }));

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

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/manage", {
        action: actionName,
        issueId: "10",
        status: "Reported",
        lastStatus: "Viewed",
      }),
      context: createContext(),
      params: {},
    }));

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

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "claim",
        issueId: "10",
        status: "Reported",
      }),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(400);
    expect(await readJson(response)).toMatchObject({
      success: false,
      message: "Claiming issues is not implemented yet.",
    });
    expect(mocks.getDB).not.toHaveBeenCalled();
  });

  it("requires admin role for permanent delete", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "delete",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    }));

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

    const response = await action(createRouteArgs({
      request: createFormRequest("https://example.com/issues/manage", {
        action: "delete",
        issueId: "10",
      }),
      context: createContext(),
      params: {},
    }));

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
