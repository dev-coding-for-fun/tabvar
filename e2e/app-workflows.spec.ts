import crypto from "node:crypto";
import { expect, test } from "./support/test";
import {
  connectTopobuilder,
  newRouteObjects,
  pngUpload,
  reviewItem,
  topobuilderApi,
} from "./support/topobuilder";

// The TopoBuilder app's workflows against the real API, with the test playing the
// app: it connects an account, proposes objects, reads their state, and pulls the
// catalog. Topo images are uploaded to the remote -dev R2 bucket (see docs/e2e-testing.md).

test.describe("as the TopoBuilder app", () => {
  test.use({ persona: "anonymous" });

  test("an anonymous contributor's objects show as in review, then publish under new ids", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const app = topobuilderApi(page.request, await connectTopobuilder(page));
    const member = await pageAs("member");
    const memberApp = topobuilderApi(member.request, await connectTopobuilder(member));
    const admin = await pageAs("admin");
    const crag = uniqueName("Crag");
    const { objects, refs } = newRouteObjects({ crag, route: uniqueName("Route") });
    const topoRef = `topo-${crypto.randomUUID()}`;
    const topoUuid = crypto.randomUUID();
    const topo = (name: string) => ({
      entity: "topo",
      ref: topoRef,
      fields: {
        uuid: topoUuid,
        name,
        sectorId: refs.sector,
        background: "file:bg",
        raster: "file:raster",
        annotations: { version: 1, items: [{ id: "line-1", kind: "climbLine", routeId: refs.route, points: [] }] },
        routes: [{ routeId: refs.route, label: "1" }],
      },
    });
    const images = { bg: pngUpload("bg.png"), raster: pngUpload("raster.png") };

    const { serverTime: before } = await app.myObjects();
    await app.submit([...objects, topo(uniqueName("Topo"))], images);
    // Sending the topo again, renamed, updates its one proposal rather than queuing another.
    const topoName = uniqueName("Topo");
    expect(await app.submit([topo(topoName)], images)).toEqual([{ entity: "topo", ref: topoRef, id: null, state: "pending" }]);

    const inReview = (await app.myObjects(before)).objects;
    expect(inReview.filter((object) => object.ref === topoRef)).toEqual([
      expect.objectContaining({ state: "pending", fields: expect.objectContaining({ name: topoName, raster: expect.stringContaining("/submissions/") }) }),
    ]);
    expect(inReview.map((object) => object.ref)).toEqual(expect.arrayContaining([refs.crag, refs.sector, refs.route]));
    expect((await memberApp.myObjects()).objects.map((object) => object.ref)).not.toContain(refs.crag);

    await reviewItem(admin, `New crag “${crag}”`, "Approve");

    const published = new Map((await app.myObjects(before)).objects.map((object) => [object.ref, object]));
    for (const ref of [refs.crag, refs.sector, refs.route, topoRef]) {
      expect(published.get(ref)).toMatchObject({ state: "published", id: expect.any(Number) });
    }
    const routeId = published.get(refs.route)!.id;

    // The catalog pulls return the published records under those ids, linked by id.
    expect(await app.route(routeId!)).toMatchObject({ sectorId: published.get(refs.sector)!.id });
    const pulled = await app.topo(topoUuid);
    expect(pulled).toMatchObject({ id: published.get(topoRef)!.id, name: topoName, status: "Active" });
    expect(pulled.routes).toEqual([expect.objectContaining({ routeId, label: "1" })]);
    expect(pulled.annotations.items).toEqual([expect.objectContaining({ id: "line-1", routeId })]);
  });

  test("only admins publish topos directly, and their edits keep what they leave out", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const app = topobuilderApi(page.request, await connectTopobuilder(page));
    const admin = await pageAs("admin");
    const adminApp = topobuilderApi(admin.request, await connectTopobuilder(admin));
    const crag = uniqueName("Crag");
    const { objects, refs } = newRouteObjects({ crag, route: uniqueName("Route") });
    await app.submit(objects);
    await reviewItem(admin, `New crag “${crag}”`, "Approve");
    const sectorId = (await app.object({ ref: refs.sector }))!.id;
    const routeId = (await app.object({ ref: refs.route }))!.id;
    const topoUuid = crypto.randomUUID();
    const name = uniqueName("Topo");

    const refused = await app.saveTopo({ uuid: topoUuid, name, sectorId });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).message).toContain("/api/topobuilder/submissions");

    const saved = await adminApp.saveTopo(
      { uuid: topoUuid, name, sectorId, routes: [{ routeId, label: "1" }] },
      { background: pngUpload("bg.png"), raster: pngUpload("raster.png") },
    );
    expect(saved.status(), await saved.text()).toBe(201);

    const edited = await adminApp.saveTopo({ uuid: topoUuid, description: "Left side" });
    expect(edited.status(), await edited.text()).toBe(200);
    expect(await app.topo(topoUuid)).toMatchObject({
      name,
      description: "Left side",
      routes: [expect.objectContaining({ routeId, label: "1" })],
    });

    expect((await adminApp.deleteTopo(topoUuid)).status()).toBe(200);
    expect(await app.topo(topoUuid)).toMatchObject({ status: "Deleted" });
  });

  test("a reporter sees their own report while it's moderated, and the app drops it once archived", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const app = topobuilderApi(page.request, await connectTopobuilder(page));
    const member = await pageAs("member");
    const memberApp = topobuilderApi(member.request, await connectTopobuilder(member));
    const admin = await pageAs("admin");
    const adminApp = topobuilderApi(admin.request, await connectTopobuilder(admin));
    const crag = uniqueName("Crag");
    const { objects, refs } = newRouteObjects({ crag, route: uniqueName("Route") });
    await app.submit(objects);
    await reviewItem(admin, `New crag “${crag}”`, "Approve");
    const routeId = (await app.object({ ref: refs.route }))!.id!;

    const mine = await app.reportIssue(routeId);
    expect(mine.issue.status).toBe("In Moderation");
    const someoneElses = await memberApp.reportIssue(routeId, { status: "In Moderation" });

    const anonymousView = (await app.issues()).issues.map((issue) => issue.id);
    expect(anonymousView).toContain(mine.serverId);
    expect(anonymousView).not.toContain(someoneElses.serverId);
    expect((await memberApp.issues()).issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining([mine.serverId, someoneElses.serverId]),
    );

    const { serverTime } = await app.issues();
    expect(await adminApp.updateIssue(mine.serverId, mine.issue.updatedAt, { status: "Archived" }))
      .toMatchObject({ status: "applied" });

    const afterArchive = await app.issues(serverTime);
    expect(afterArchive.hiddenIssueIds).toContain(mine.serverId);
    expect(afterArchive.issues.map((issue) => issue.id)).not.toContain(mine.serverId);
  });
});
