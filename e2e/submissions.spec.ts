import { expect, test } from "./support/test";
import { approveSubmission, connectTopobuilder, newRouteChanges, topobuilderApi } from "./support/topobuilder";

// Member submissions through the TopoBuilder API, reviewed by an admin on
// /admin/submissions. Submissions here carry no files, so nothing is uploaded to R2.

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

    const submissionId = await api.submit(newRouteChanges({ crag, route }));
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
    const created = await api.submit(newRouteChanges({ crag: uniqueName("Crag"), route }));
    await approveSubmission(admin, created);
    const routeId = (await api.status(created)).ids!.r1;
    const { updatedAt } = await api.route(routeId);

    const kept = await api.submit([
      { entity: "route", op: "update", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10b" } },
    ]);
    const competing = await api.submit([
      { entity: "route", op: "update", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10c" } },
    ]);

    await admin.goto(`/admin/submissions?id=${kept}`);
    await expect(admin.getByText(`Edit route “${route}”`)).toBeVisible();
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
