import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createMockDb,
  createRouteArgs,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
  describeSubmissionChanges: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/submissionView.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/submissionView.server")>()),
  describeSubmissionChanges: mocks.describeSubmissionChanges,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/submissionReview.server", () => ({
  approveSubmission: mocks.approveSubmission,
  rejectSubmission: mocks.rejectSubmission,
}));

import { action, loader } from "./admin.submissions";

const review = (fields: Record<string, string>) => action(createRouteArgs({
  request: createFormRequest("https://example.com/admin/submissions", fields),
  context: createContext(),
  params: {},
}));

describe("admin.submissions action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets admins and supers decide as themselves, then moves on to the next submission", async () => {
    const reviewer = createUser({ uid: "super-1", role: "super" });
    mocks.requireUser.mockResolvedValue(reviewer);
    mocks.getDB.mockReturnValue(createMockDb({ select: [{ executeTakeFirst: { id: "sub-3" } }, { executeTakeFirst: undefined }] }));
    mocks.approveSubmission.mockResolvedValue({ ok: true, ids: { r1: 5 } });
    mocks.rejectSubmission.mockResolvedValue({ ok: true, ids: {} });

    const approved = await review({ id: "sub-1", intent: "approve" });
    expect(getStatus(approved)).toBe(302);
    expect((approved as Response).headers.get("Location")).toBe("/admin/submissions?id=sub-3");
    expect(mocks.approveSubmission).toHaveBeenCalledWith(expect.anything(), { id: "sub-1", reviewer });

    const rejected = await review({ id: "sub-2", intent: "reject" });
    expect((rejected as Response).headers.get("Location")).toBe("/admin/submissions");
    expect(mocks.rejectSubmission).toHaveBeenCalledWith(expect.anything(), { id: "sub-2", reviewer });
  });

  it("reports a failed approval", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    mocks.approveSubmission.mockResolvedValue({ ok: false, error: "route 100 no longer exists." });

    const response = await review({ id: "sub-1", intent: "approve" });

    expect(getStatus(response)).toBe(409);
    expect(await readJson(response)).toEqual({ ok: false, error: "route 100 no longer exists." });
  });

  it("refuses members and malformed requests", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));
    expect(getStatus(await review({ id: "sub-1", intent: "approve" }))).toBe(403);

    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    expect(getStatus(await review({ id: "sub-1", intent: "merge" }))).toBe(400);

    expect(mocks.approveSubmission).not.toHaveBeenCalled();
    expect(mocks.rejectSubmission).not.toHaveBeenCalled();
  });
});

describe("admin.submissions loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists queued submissions without their payloads and describes the selected one", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    const payload = { changes: [{ entity: "route", op: "update", id: 100, fields: { boltCount: 7 } }] };
    mocks.getDB.mockReturnValue(createMockDb({
      select: [{
        execute: [{
          id: "sub-1",
          uid: "submitter",
          source: "topobuilder",
          payload: JSON.stringify(payload),
          error: null,
          createdAt: "2026-10-16 12:00:00",
          submitterName: "Submitter",
          submitterEmail: null,
        }],
      }],
    }));
    mocks.describeSubmissionChanges.mockResolvedValue([{ index: 0, title: "Edit route" }]);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/admin/submissions?id=sub-1"),
      context: createContext(),
      params: {},
    }));

    const body = await readJson(response);
    expect(body.submissions).toEqual([expect.objectContaining({ id: "sub-1", counts: { creates: 0, edits: 1 } })]);
    expect(body.submissions[0]).not.toHaveProperty("payload");
    expect(body.selected).toEqual({ id: "sub-1", changes: [{ index: 0, title: "Edit route" }] });
    expect(mocks.describeSubmissionChanges).toHaveBeenCalledWith(expect.anything(), payload);
  });

  it("refuses members", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/admin/submissions"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(403);
    expect(mocks.getDB).not.toHaveBeenCalled();
  });
});
