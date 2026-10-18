import crypto from "node:crypto";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect } from "./test";

/**
 * Plays the TopoBuilder app's side of the TABVAR APIs in e2e specs: connecting
 * an account, submitting route data, polling "my submissions", pulling the
 * catalog, syncing issues, and (for admins) publishing topos directly.
 */

// An allowlisted TopoBuilder dev callback (env.dev TOPOBUILDER_RETURN_TO_ALLOWLIST).
// Nothing listens there; the connect page's redirect is intercepted to read the ticket.
const CALLBACK = "http://localhost:8081/tabvar/callback";

// A 1x1 PNG. Identical bytes keep content-hashed uploads to the -dev bucket small.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export function pngUpload(name: string) {
  return { name, mimeType: "image/png", buffer: PNG };
}

export type MySubmission =
  | { id: string; status: "pending"; createdAt: string; error: string | null; changes: SubmissionChange[] }
  | { id: string; status: "approved" | "rejected"; decidedAt: string; ids: Record<string, number> };

type SubmissionChange = { ref?: string; entity: string; op: string; id?: number; fields: Record<string, unknown> };
type MySubmissionList = { submissions: MySubmission[]; serverTime: string };
type IssuePull = { issues: { id: number; status: string }[]; hiddenIssueIds: number[]; serverTime: string };

/** Finds a submission in a "my submissions" list and checks its status. */
export function findSubmission<S extends MySubmission["status"]>(
  list: MySubmissionList,
  id: string,
  status: S,
): MySubmission & { status: S } {
  const found = list.submissions.find((submission) => submission.id === id);
  expect(found?.status, `submission ${id}`).toBe(status);
  return found as MySubmission & { status: S };
}
type SubmissionStatus = { id: string; status: string; ids?: Record<string, number>; error?: string | null };
type Upload = ReturnType<typeof pngUpload>;

/** Connects TopoBuilder as the page's user, the way the app does, and returns its API token. */
export async function connectTopobuilder(page: Page): Promise<string> {
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ body: "TopoBuilder" }));
  const callback = page.waitForRequest(`${CALLBACK}**`);
  await page.goto(`/connect/topobuilder?return_to=${encodeURIComponent(CALLBACK)}`);
  const ticket = new URL((await callback).url()).searchParams.get("ticket");

  const response = await page.request.post("/api/topobuilder/connect/complete", { data: { ticket } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).token;
}

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

export function topobuilderApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const withSince = (path: string, since?: string) => (since ? `${path}?since=${encodeURIComponent(since)}` : path);

  return {
    async submit(changes: unknown[], files: Record<string, Upload> = {}): Promise<string> {
      const response = Object.keys(files).length > 0
        ? await request.post("/api/topobuilder/submissions", {
          headers,
          multipart: { submission: JSON.stringify({ changes }), ...files },
        })
        : await request.post("/api/topobuilder/submissions", { headers, data: { changes } });
      return (await json<{ id: string }>(response, 201)).id;
    },
    status(id: string): Promise<SubmissionStatus> {
      return request.get(`/api/topobuilder/submissions?id=${encodeURIComponent(id)}`, { headers }).then(json<SubmissionStatus>);
    },
    mySubmissions(since?: string): Promise<MySubmissionList> {
      return request.get(withSince("/api/topobuilder/submissions", since), { headers }).then(json<MySubmissionList>);
    },
    async route(id: number): Promise<{ id: number; sectorId: number | null; gradeYds: string | null; updatedAt: string }> {
      const { routes } = await request.get("/api/v1/routes", { headers }).then(json<{ routes: { id: number }[] }>);
      return routes.find((route) => route.id === id) as never;
    },
    async topo(uuid: string) {
      const { topo } = await request.get(`/api/v1/topos?uuid=${encodeURIComponent(uuid)}`, { headers })
        .then(json<{ topo: { id: number; name: string; description: string | null; status: string; rasterImageUrl: string; routes: { routeId: number; label: string | null }[] } }>);
      return topo;
    },
    saveTopo(payload: unknown, files: Record<string, Upload> = {}): Promise<APIResponse> {
      return request.post("/api/v1/topos", { headers, multipart: { payload: JSON.stringify(payload), ...files } });
    },
    deleteTopo(uuid: string): Promise<APIResponse> {
      return request.delete(`/api/v1/topos?uuid=${encodeURIComponent(uuid)}`, { headers });
    },
    issues(since?: string): Promise<IssuePull> {
      return request.get(withSince("/api/v1/issues", since), { headers }).then(json<IssuePull>);
    },
    async reportIssue(routeId: number, fields: Record<string, unknown> = {}) {
      const response = await request.post("/api/v1/issues/sync", {
        headers,
        data: { op: "create", externalId: crypto.randomUUID(), fields: { routeId, issueType: "Bolts", description: "Spinner on bolt 2", ...fields } },
      });
      return (await json<{ serverId: number; issue: { status: string; updatedAt: string } }>(response, 201));
    },
    async updateIssue(issueId: number, baseUpdatedAt: string, fields: Record<string, unknown>) {
      const response = await request.post("/api/v1/issues/sync", { headers, data: { op: "update", issueId, baseUpdatedAt, fields } });
      return json<{ status: string }>(response);
    },
  };
}

/** Approves a submission as an admin, the way the review page's Approve button does. */
export async function approveSubmission(admin: Page, id: string) {
  const response = await admin.request.post("/admin/submissions", { form: { id, intent: "approve" }, maxRedirects: 0 });
  expect(response.status()).toBe(302);
}

/** A new crag, sector, and route, as one submission's changes. */
export function newRouteChanges(names: { crag: string; route: string }) {
  return [
    { ref: "c1", entity: "crag", op: "create", fields: { name: names.crag } },
    { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: "c1" } },
    { ref: "r1", entity: "route", op: "create", fields: { name: names.route, sectorId: "s1", gradeYds: "5.10a" } },
  ];
}
