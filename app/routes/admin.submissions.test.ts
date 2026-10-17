import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createFormRequest, createRouteArgs, createUser, getStatus, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/submissionReview.server", () => ({
  approveSubmission: mocks.approveSubmission,
  rejectSubmission: mocks.rejectSubmission,
}));

import { action } from "./admin.submissions";

const review = (fields: Record<string, string>) => action(createRouteArgs({
  request: createFormRequest("https://example.com/admin/submissions", fields),
  context: createContext(),
  params: {},
}));

describe("admin.submissions action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets admins and supers approve or reject as themselves", async () => {
    const reviewer = createUser({ uid: "super-1", role: "super" });
    mocks.requireUser.mockResolvedValue(reviewer);
    mocks.approveSubmission.mockResolvedValue({ ok: true, ids: { r1: 5 } });
    mocks.rejectSubmission.mockResolvedValue({ ok: true, ids: {} });

    const approved = await review({ id: "sub-1", intent: "approve" });
    expect(await readJson(approved)).toEqual({ ok: true, ids: { r1: 5 } });
    expect(mocks.approveSubmission).toHaveBeenCalledWith(expect.anything(), { id: "sub-1", reviewer });

    await review({ id: "sub-2", intent: "reject" });
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
