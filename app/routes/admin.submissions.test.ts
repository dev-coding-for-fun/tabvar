import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewChain } from "~/lib/submissionReview.server";
import {
  createContext,
  createFormRequest,
  createGetRequest,
  createRouteArgs,
  createSubmissionObject,
  createUser,
  getStatus,
  readJson,
} from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireUser: vi.fn(),
  approveChain: vi.fn(),
  rejectChain: vi.fn(),
  loadPendingChains: vi.fn(),
  describeObjects: vi.fn(),
  findConflicts: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/auth.server", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("~/lib/submissionReview.server", () => ({
  approveChain: mocks.approveChain,
  rejectChain: mocks.rejectChain,
  loadPendingChains: mocks.loadPendingChains,
}));

vi.mock("~/lib/submissionView.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/submissionView.server")>()),
  describeObjects: mocks.describeObjects,
}));

vi.mock("~/lib/submissionConflicts.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/submissionConflicts.server")>()),
  findConflicts: mocks.findConflicts,
}));

import { action, loader } from "./admin.submissions";

function chain(objects: ReviewChain["objects"]): ReviewChain {
  return {
    key: Math.min(...objects.map((object) => object.id)),
    uid: "submitter",
    source: "topobuilder",
    author: { uid: "submitter", displayName: "Submitter" },
    authorEmail: "submitter@example.com",
    objects,
  };
}

const review = (fields: Record<string, string>) => action(createRouteArgs({
  request: createFormRequest("https://example.com/admin/submissions", fields),
  context: createContext(),
  params: {},
}));

describe("admin.submissions action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets admins and supers decide as themselves, then moves on to the next item", async () => {
    const reviewer = createUser({ uid: "super-1", role: "super" });
    mocks.requireUser.mockResolvedValue(reviewer);
    const next = chain([createSubmissionObject({ entity: "crag", ref: "c9", fields: { name: "Next" } })]);
    mocks.loadPendingChains.mockResolvedValueOnce([next]).mockResolvedValueOnce([]);
    mocks.approveChain.mockResolvedValue({ ok: true });
    mocks.rejectChain.mockResolvedValue({ ok: true });

    const approved = await review({ item: "11", intent: "approve" });
    expect(getStatus(approved)).toBe(302);
    expect((approved as Response).headers.get("Location")).toBe(`/admin/submissions?item=${next.key}`);
    expect(mocks.approveChain).toHaveBeenCalledWith(expect.anything(), { item: 11, reviewer });

    const rejected = await review({ item: "12", intent: "reject" });
    expect((rejected as Response).headers.get("Location")).toBe("/admin/submissions");
    expect(mocks.rejectChain).toHaveBeenCalledWith(expect.anything(), { item: 12, reviewer });
  });

  it("reports a failed approval", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    mocks.approveChain.mockResolvedValue({ ok: false, error: "route 100 no longer exists." });

    const response = await review({ item: "11", intent: "approve" });

    expect(getStatus(response)).toBe(409);
    expect(await readJson(response)).toEqual({ ok: false, error: "route 100 no longer exists." });
  });

  it("refuses members and malformed requests", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));
    expect(getStatus(await review({ item: "11", intent: "approve" }))).toBe(403);

    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    expect(getStatus(await review({ item: "11", intent: "merge" }))).toBe(400);
    expect(getStatus(await review({ item: "abc", intent: "approve" }))).toBe(400);

    expect(mocks.approveChain).not.toHaveBeenCalled();
    expect(mocks.rejectChain).not.toHaveBeenCalled();
  });
});

describe("admin.submissions loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists pending chains and describes the one containing the selected object", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "admin" }));
    mocks.getDB.mockReturnValue({});
    const crag = createSubmissionObject({ entity: "crag", ref: "c1", fields: { name: "New Crag" }, receivedAt: "2026-10-16 12:00:00" });
    const edit = createSubmissionObject({ entity: "route", targetId: 100, fields: { boltCount: 7 }, error: "Route is locked" });
    const pending = chain([crag, edit]);
    mocks.loadPendingChains.mockResolvedValue([pending]);
    mocks.describeObjects.mockResolvedValue([{ key: edit.id, title: "Edit route" }]);
    const conflict = { fieldConflicts: [], overlaps: [], recordChanged: { kind: "unrecorded", updatedAt: "2026-10-16 13:00:00" } };
    mocks.findConflicts.mockResolvedValue(new Map([[edit.id, conflict]]));

    const response = await loader(createRouteArgs({
      request: createGetRequest(`https://example.com/admin/submissions?item=${edit.id}`),
      context: createContext(),
      params: {},
    }));

    const body = await readJson(response);
    expect(body.chains).toEqual([{
      item: pending.key,
      title: "New crag “New Crag”",
      uid: "submitter",
      source: "topobuilder",
      error: "Route is locked",
      receivedAt: "2026-10-16 12:00:00",
      submitterName: "Submitter",
      submitterEmail: "submitter@example.com",
      counts: { creates: 1, edits: 1 },
      conflictCounts: { conflicts: 0, warnings: 1 },
    }]);
    expect(body.selected).toEqual({ item: pending.key, changes: [{ key: edit.id, title: "Edit route" }], conflicts: { [edit.id]: conflict } });
    expect(mocks.describeObjects).toHaveBeenCalledWith(expect.anything(), [crag, edit]);
  });

  it("refuses members", async () => {
    mocks.requireUser.mockResolvedValue(createUser({ role: "member" }));

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/admin/submissions"),
      context: createContext(),
      params: {},
    }));

    expect(getStatus(response)).toBe(403);
    expect(mocks.loadPendingChains).not.toHaveBeenCalled();
  });
});
