import crypto from "node:crypto";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect } from "./test";

/**
 * Plays the TopoBuilder app's side of the TABVAR APIs in e2e specs: connecting
 * an account, proposing objects, reading their review state, pulling the
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

/** One of the caller's objects, as listed by the submissions API. */
export type MyObject = {
  entity: string;
  ref: string | null;
  id: number | null;
  state: "pending" | "published" | "rejected";
  fields: Record<string, unknown>;
  error: string | null;
};

type ReceivedObject = { entity: string; ref: string | null; id: number | null; state: string };
type MyObjectList = { objects: MyObject[]; serverTime: string };
type IssuePull = { issues: { id: number; status: string }[]; hiddenIssueIds: number[]; serverTime: string };
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

  const api = {
    /** Proposes (or withdraws) objects; sending the same objects again is safe. */
    async submit(objects: unknown[], files: Record<string, Upload> = {}): Promise<ReceivedObject[]> {
      const response = Object.keys(files).length > 0
        ? await request.post("/api/topobuilder/submissions", {
          headers,
          multipart: { submission: JSON.stringify({ objects }), ...files },
        })
        : await request.post("/api/topobuilder/submissions", { headers, data: { objects } });
      return (await json<{ objects: ReceivedObject[] }>(response)).objects;
    },
    myObjects(since?: string): Promise<MyObjectList> {
      return request.get(withSince("/api/topobuilder/submissions", since), { headers }).then(json<MyObjectList>);
    },
    /** One of the caller's objects, by its ref or (for an edit) its record. */
    async object(key: { ref: string } | { entity: string; id: number }): Promise<MyObject | undefined> {
      const { objects } = await api.myObjects();
      return objects.find((object) => ("ref" in key
        ? object.ref === key.ref
        : object.entity === key.entity && object.id === key.id));
    },
    async route(id: number): Promise<{ id: number; sectorId: number | null; gradeYds: string | null; updatedAt: string }> {
      const { routes } = await request.get("/api/v1/routes", { headers }).then(json<{ routes: { id: number }[] }>);
      return routes.find((route) => route.id === id) as never;
    },
    async topo(uuid: string) {
      const { topo } = await request.get(`/api/v1/topos?uuid=${encodeURIComponent(uuid)}`, { headers })
        .then(json<{ topo: {
          id: number;
          name: string;
          description: string | null;
          status: string;
          rasterImageUrl: string;
          routes: { routeId: number; label: string | null }[];
          annotations: { version: number; items: Record<string, unknown>[] };
        } }>);
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
      return json<{ serverId: number; issue: { status: string; updatedAt: string } }>(response, 201);
    },
    async updateIssue(issueId: number, baseUpdatedAt: string, fields: Record<string, unknown>) {
      const response = await request.post("/api/v1/issues/sync", { headers, data: { op: "update", issueId, baseUpdatedAt, fields } });
      return json<{ status: string }>(response);
    },
  };
  return api;
}

/**
 * Opens a review item on /admin/submissions by its title (and submitter, when
 * several accounts propose the same thing) and approves or rejects it.
 */
export async function reviewItem(admin: Page, title: string, decision: "Approve" | "Reject", submitter?: string) {
  await admin.goto("/admin/submissions");
  let item = admin.getByRole("link").filter({ hasText: title });
  if (submitter) item = item.filter({ hasText: submitter });
  await item.click();
  await expect(admin).toHaveURL(/item=/);
  const selected = admin.url();
  await admin.getByRole("button", { name: decision }).click();
  await expect(admin).not.toHaveURL(selected);
  await expect(item).toBeHidden();
}

/** A new crag, sector, and route, with refs unique to this run so each test proposes its own objects. */
export function newRouteObjects(names: { crag: string; route: string }) {
  const run = crypto.randomUUID();
  const refs = { crag: `crag-${run}`, sector: `sector-${run}`, route: `route-${run}` };
  return {
    refs,
    objects: [
      { entity: "crag", ref: refs.crag, fields: { name: names.crag } },
      { entity: "sector", ref: refs.sector, fields: { name: "Main Wall", cragId: refs.crag } },
      { entity: "route", ref: refs.route, fields: { name: names.route, sectorId: refs.sector, gradeYds: "5.10a" } },
    ],
  };
}
