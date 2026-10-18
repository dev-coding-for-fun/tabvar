import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/test";

// Member submissions through the TopoBuilder API, reviewed by an admin on
// /admin/submissions. Submissions here carry no files, so nothing is uploaded to R2.

// An allowlisted TopoBuilder dev callback (env.dev TOPOBUILDER_RETURN_TO_ALLOWLIST).
// Nothing listens there; the connect page's redirect is intercepted to read the ticket.
const CALLBACK = "http://localhost:8081/tabvar/callback";

type SubmissionStatus = { id: string; status: string; ids?: Record<string, number>; error?: string | null };

/** Connects TopoBuilder as the page's user, the way the app does, and returns its API token. */
async function connectTopobuilder(page: Page): Promise<string> {
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ body: "TopoBuilder" }));
  const callback = page.waitForRequest(`${CALLBACK}**`);
  await page.goto(`/connect/topobuilder?return_to=${encodeURIComponent(CALLBACK)}`);
  const ticket = new URL((await callback).url()).searchParams.get("ticket");

  const response = await page.request.post("/api/topobuilder/connect/complete", { data: { ticket } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).token;
}

function topobuilderApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async submit(changes: unknown[]): Promise<string> {
      const response = await request.post("/api/topobuilder/submissions", { headers, data: { changes } });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).id;
    },
    async status(id: string): Promise<SubmissionStatus> {
      const response = await request.get(`/api/topobuilder/submissions?id=${encodeURIComponent(id)}`, { headers });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    },
    async route(id: number): Promise<{ id: number; gradeYds: string | null; updatedAt: string }> {
      const response = await request.get("/api/v1/routes", { headers });
      expect(response.status()).toBe(200);
      const { routes } = await response.json();
      return routes.find((route: { id: number }) => route.id === id);
    },
  };
}

test.describe("submission review", () => {
  test.use({ persona: "member" });

  test("a member's new crag, sector, and route are published once an admin approves them", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const api = topobuilderApi(page.request, await connectTopobuilder(page));
    const crag = uniqueName("Crag");
    const route = uniqueName("Route");

    const submissionId = await api.submit([
      { ref: "c1", entity: "crag", op: "create", fields: { name: crag } },
      { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: "c1" } },
      { ref: "r1", entity: "route", op: "create", fields: { name: route, sectorId: "s1", gradeYds: "5.10a" } },
    ]);
    expect(await api.status(submissionId)).toMatchObject({ status: "pending" });

    const admin = await pageAs("admin");
    await admin.goto(`/admin/submissions?id=${submissionId}`);
    await expect(admin.getByText(`New crag “${crag}”`).first()).toBeVisible();
    await expect(admin.getByText("New sector “Main Wall”").first()).toBeVisible();
    await expect(admin.getByText(`New route “${route}”`)).toBeVisible();

    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin).not.toHaveURL(new RegExp(submissionId));

    const decided = await api.status(submissionId);
    expect(decided).toMatchObject({ status: "approved", ids: { c1: expect.any(Number), r1: expect.any(Number) } });

    await page.goto(`/topos/${decided.ids!.c1}`);
    await expect(page.getByRole("heading", { name: crag })).toBeVisible();
    await expect(page.getByText(route)).toBeVisible();
  });

  test("competing edits to a route are flagged, and only the approved one is applied", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const api = topobuilderApi(page.request, await connectTopobuilder(page));
    const admin = await pageAs("admin");
    const route = uniqueName("Route");

    // An existing route to edit, published through an approved submission.
    const created = await api.submit([
      { ref: "c1", entity: "crag", op: "create", fields: { name: uniqueName("Crag") } },
      { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: "c1" } },
      { ref: "r1", entity: "route", op: "create", fields: { name: route, sectorId: "s1", gradeYds: "5.10a" } },
    ]);
    const approve = await admin.request.post("/admin/submissions", {
      form: { id: created, intent: "approve" },
      maxRedirects: 0,
    });
    expect(approve.status()).toBe(302);
    const routeId = (await api.status(created)).ids!.r1;
    const { updatedAt } = await api.route(routeId);

    const kept = await api.submit([
      { entity: "route", op: "update", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10b" } },
    ]);
    const competing = await api.submit([
      { entity: "route", op: "update", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10c" } },
    ]);

    await admin.goto(`/admin/submissions?id=${kept}`);
    const card = admin.getByText(`Edit route “${route}”`);
    await expect(card).toBeVisible();
    await expect(admin.getByRole("cell", { name: "5.10a" })).toBeVisible();
    await expect(admin.getByRole("cell", { name: "5.10b" })).toBeVisible();
    await expect(admin.getByRole("alert").filter({ hasText: "Conflicts" })).toContainText("Grade is also edited in");

    await admin.getByRole("link", { name: "a submission from E2E member" }).click();
    await expect(admin).toHaveURL(new RegExp(competing));
    await expect(admin.getByRole("cell", { name: "5.10c" })).toBeVisible();
    await admin.getByRole("button", { name: "Reject" }).click();
    await expect(admin).not.toHaveURL(new RegExp(competing));

    await admin.goto(`/admin/submissions?id=${kept}`);
    await expect(admin.getByRole("alert").filter({ hasText: "Conflicts" })).toBeHidden();
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(admin).not.toHaveURL(new RegExp(kept));

    expect(await api.status(competing)).toMatchObject({ status: "rejected" });
    expect(await api.status(kept)).toMatchObject({ status: "approved" });
    expect((await api.route(routeId)).gradeYds).toBe("5.10b");
  });
});
