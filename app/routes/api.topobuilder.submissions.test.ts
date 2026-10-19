// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createGetRequest, createRouteArgs, readJson } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  receiveObjects: vi.fn(),
  listMyObjects: vi.fn(),
  parseSubmissionRequest: vi.fn(),
}));

vi.mock("~/lib/topobuilderAuth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/topobuilderAuth.server")>()),
  requireApiToken: mocks.requireApiToken,
}));

vi.mock("~/lib/submission.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/submission.server")>()),
  receiveObjects: mocks.receiveObjects,
  listMyObjects: mocks.listMyObjects,
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
    mocks.parseSubmissionRequest.mockResolvedValue({ payload: { objects: [] }, files: new Map() });
  });

  it("receives the token user's objects and reports each one's state", async () => {
    const objects = [{ entity: "crag", ref: "c1", id: null, state: "pending" }];
    mocks.receiveObjects.mockResolvedValue(objects);

    const response = await action(post());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ objects });
    expect(mocks.receiveObjects).toHaveBeenCalledWith(expect.anything(), {
      uid: "submitter",
      source: "topobuilder",
      payload: { objects: [] },
      files: new Map(),
    });
  });

  it("returns 400 with the validation message for an invalid submission", async () => {
    mocks.receiveObjects.mockRejectedValue(new SubmissionValidationError("objects[0].entity must be one of crag, sector, route, topo"));

    const response = await action(post());

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "invalid_submission",
      message: "objects[0].entity must be one of crag, sector, route, topo",
    });
  });

  it("returns 500 when storing the submission fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.receiveObjects.mockRejectedValue(new Error("R2 unavailable"));

    const response = await action(post());

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual(expect.objectContaining({ error: "server_error" }));
  });

  it("lists the caller's own objects since a cursor", async () => {
    const list = { objects: [{ entity: "crag", ref: "c1", id: 41, state: "published" }], serverTime: "2026-10-16 12:00:00" };
    mocks.listMyObjects.mockResolvedValue(list);

    const response = await loader(createRouteArgs({
      request: createGetRequest("https://example.com/api/topobuilder/submissions?since=2026-10-15%2000:00:00"),
      context: createContext(),
      params: {},
    }));

    expect(await readJson(response)).toEqual(list);
    expect(mocks.listMyObjects).toHaveBeenCalledWith(expect.anything(), { uid: "submitter", since: "2026-10-15 00:00:00" });
  });
});
