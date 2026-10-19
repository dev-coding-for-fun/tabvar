import { expect, test } from "./support/test";
import { connectTopobuilder, newRouteObjects, reviewItem, topobuilderApi } from "./support/topobuilder";

// Objects proposed through the TopoBuilder API, reviewed by an admin on
// /admin/submissions. Nothing here uploads files, so nothing goes to R2.

test.describe("submission review", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ persona: "member" });

  test("a member's new crag, sector, and route are published once an admin approves them", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const api = topobuilderApi(page.request, await connectTopobuilder(page));
    const crag = uniqueName("Crag");
    const route = uniqueName("Route");
    const { objects, refs } = newRouteObjects({ crag, route });

    await api.submit(objects);
    expect(await api.object({ ref: refs.crag })).toMatchObject({ state: "pending", id: null });

    const admin = await pageAs("admin");
    await admin.goto("/admin/submissions");
    const item = admin.getByRole("link").filter({ hasText: `New crag “${crag}”` });
    await expect(item).toBeVisible();
    await item.click();
    await expect(admin.getByText("New sector “Main Wall”").first()).toBeVisible();
    await expect(admin.getByText(`New route “${route}”`)).toBeVisible();
    await admin.getByRole("button", { name: "Approve" }).click();
    await expect(item).toBeHidden();
    await expect(admin.getByText(`New route “${route}”`)).toBeHidden();

    const published = await api.object({ ref: refs.crag });
    expect(published).toMatchObject({ state: "published", id: expect.any(Number) });
    await page.goto(`/topos/${published!.id}`);
    await expect(page.getByRole("heading", { name: crag })).toBeVisible();
    await expect(page.getByText(route)).toBeVisible();
  });

  test("competing edits from two accounts are flagged, and only the approved one is applied", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const api = topobuilderApi(page.request, await connectTopobuilder(page));
    const other = await pageAs("anonymous");
    const otherApi = topobuilderApi(other.request, await connectTopobuilder(other));
    const admin = await pageAs("admin");
    const route = uniqueName("Route");
    const crag = uniqueName("Crag");

    // An existing route to edit, published through an approved proposal.
    const { objects, refs } = newRouteObjects({ crag, route });
    await api.submit(objects);
    await reviewItem(admin, `New crag “${crag}”`, "Approve");
    const routeId = (await api.object({ ref: refs.route }))!.id!;
    const { updatedAt } = await api.route(routeId);

    await api.submit([{ entity: "route", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10b" } }]);
    await otherApi.submit([{ entity: "route", id: routeId, baseUpdatedAt: updatedAt, fields: { gradeYds: "5.10c" } }]);

    const title = `Edit route #${routeId}`;
    await admin.goto("/admin/submissions");
    const memberItem = admin.getByRole("link").filter({ hasText: title }).filter({ hasText: "E2E member" });
    await expect(memberItem).toBeVisible();
    await memberItem.click();
    const table = admin.getByRole("table");
    await expect(table.getByRole("cell", { name: "5.10a" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "5.10b" })).toBeVisible();
    await expect(admin.getByRole("alert").filter({ hasText: "Conflicts" })).toContainText("Grade is also edited in");

    const anonLink = admin.getByRole("link", { name: "a submission from E2E anonymous" });
    await expect(anonLink).toBeVisible();
    await anonLink.click();
    await expect(table.getByRole("cell", { name: "5.10c" })).toBeVisible();
    await admin.getByRole("button", { name: "Reject" }).click();
    await expect(table.getByRole("cell", { name: "5.10c" })).toBeHidden();
    await expect(table.getByRole("cell", { name: "5.10b" })).toBeVisible();

    await reviewItem(admin, title, "Approve", "E2E member");

    await expect.poll(async () => (await otherApi.object({ entity: "route", id: routeId }))?.state).toBe("rejected");
    await expect.poll(async () => (await api.object({ ref: refs.route }))?.state).toBe("published");
    await expect.poll(async () => (await api.route(routeId)).gradeYds).toBe("5.10b");
  });
});
