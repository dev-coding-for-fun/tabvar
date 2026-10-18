// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createRouteArgs, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  createSubmission: vi.fn(),
  getSubmissionStatus: vi.fn(),
  listMySubmissions: vi.fn(),
  parseSubmissionRequest: vi.fn(),
}));

vi.mock("~/lib/topobuilderAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/topobuilderAuth.server")>()),
  requireApiToken: mocks.requireApiToken,
}));

vi.mock("~/lib/submission.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/submission.server")>()),
  createSubmission: mocks.createSubmission,
  getSubmissionStatus: mocks.getSubmissionStatus,
  listMySubmissions: mocks.listMySubmissions,
  parseSubmissionRequest: mocks.parseSubmissionRequest,
}));

import { SubmissionValidationError } from "~/lib/submission.server";
import { action, loader } from "./api.topobuilder.submissions";

const post = () => createRouteArgs({
  request: new Request("https://example.com/api/topobuilder/submissions", { method: "POST", body: "{}" }),
  context: createContext(),
  params: {},
});

describe("api.topobuilder.submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiToken.mockResolvedValue({ tokenId: "t1", uid: "submitter", client: "topobuilder" });
    mocks.parseSubmissionRequest.mockResolvedValue({ payload: { changes: [] }, files: new Map() });
  });

  it("queues a submission for the token's user", async () => {
    mocks.createSubmission.mockResolvedValue({ id: "s-1", status: "pending" });

    const response = await action(post());

    expect(response.status).toBe(201);
    expect(await readJson(response)).toEqual({ id: "s-1", status: "pending" });
    expect(mocks.createSubmission).toHaveBeenCalledWith(expect.anything(), {
      uid: "submitter",
      source: "topobuilder",
      payload: { changes: [] },
      files: new Map(),
    });
  });

  it("returns 400 with the validation message for an invalid submission", async () => {
    mocks.createSubmission.mockRejectedValue(new SubmissionValidationError("changes[0].op must be create or update"));

    const response = await action(post());

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "invalid_submission",
      message: "changes[0].op must be create or update",
    });
  });

  it("returns 500 when storing the submission fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createSubmission.mockRejectedValue(new Error("R2 unavailable"));

    const response = await action(post());

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual(expect.objectContaining({ error: "server_error" }));
  });

  it("reports the caller's submission status, or 404", async () => {
    mocks.getSubmissionStatus.mockResolvedValueOnce({ id: "s-1", status: "approved", ids: { r1: 301 } });
    const found = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/topobuilder/submissions?id=s-1"),
      context: createContext(),
      params: {},
    }));
    expect(await readJson(found)).toEqual({ id: "s-1", status: "approved", ids: { r1: 301 } });
    expect(mocks.getSubmissionStatus).toHaveBeenCalledWith(expect.anything(), { uid: "submitter", id: "s-1" });

    mocks.getSubmissionStatus.mockResolvedValueOnce(null);
    const missing = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/topobuilder/submissions?id=other"),
      context: createContext(),
      params: {},
    }));
    expect(missing.status).toBe(404);
  });

  it("lists the caller's own submissions when no id is given", async () => {
    const list = { submissions: [{ id: "s-1", status: "pending" }], serverTime: "2026-10-16 12:00:00" };
    mocks.listMySubmissions.mockResolvedValue(list);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/topobuilder/submissions?since=2026-10-15%2000:00:00"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual(list);
    expect(mocks.listMySubmissions).toHaveBeenCalledWith(expect.anything(), {
      uid: "submitter",
      since: "2026-10-15 00:00:00",
    });
  });
});
