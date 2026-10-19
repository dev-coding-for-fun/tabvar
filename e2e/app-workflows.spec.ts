import crypto from "node:crypto";
import { expect, test } from "./support/test";
import {
  approveSubmission,
  connectTopobuilder,
  findSubmission,
  newRouteChanges,
  pngUpload,
  topobuilderApi,
} from "./support/topobuilder";

// The TopoBuilder app's workflows against the real API, with the test playing the
// app: it connects an account, submits, polls its submissions, and pulls the catalog.
// Topo images are uploaded to the remote -dev R2 bucket (see docs/e2e-testing.md).

test.describe("as the TopoBuilder app", () => {
  test.use({ persona: "anonymous" });

  test("an anonymous contributor's topo shows as in review, then the app adopts the published ids", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const app = topobuilderApi(page.request, await connectTopobuilder(page));
    const memberApp = topobuilderApi((await pageAs("member")).request, await connectTopobuilder(await pageAs("member")));
    const admin = await pageAs("admin");
    const route = uniqueName("Route");
    const topoUuid = crypto.randomUUID();
    const crag = uniqueName("Crag");
    const changesFor = (topoName: string) => [
      ...newRouteChanges({ crag, route }),
      {
        ref: "t1",
        entity: "topo",
        op: "create",
        fields: {
          uuid: topoUuid,
          name: topoName,
          sectorId: "s1",
          background: "file:bg",
          raster: "file:raster",
          annotations: { version: 1, items: [] },
          routes: [{ routeId: "r1", label: "1" }],
        },
      },
    ];
    const images = { bg: pngUpload("bg.png"), raster: pngUpload("raster.png") };

    const { serverTime: before } = await app.mySubmissions();
    const submissionId = await app.submit(changesFor(uniqueName("Topo")), images);

    // The user edits the topo before review; resubmitting replaces the pending submission.
    const topoName = uniqueName("Topo");
    expect(await app.resubmit(submissionId, changesFor(topoName), images)).toBe(submissionId);

    // In review: the app sees its pending changes, with uploaded images stored for review.
    const pending = findSubmission(await app.mySubmissions(before), submissionId, "pending");
    expect(pending.error).toBeNull();
    const topoChange = pending.changes.find((change) => change.entity === "topo");
    expect(topoChange?.fields).toMatchObject({ name: topoName, raster: expect.stringContaining(`/submissions/${submissionId}/`) });
    expect((await app.mySubmissions(before)).submissions.filter((submission) => submission.status === "pending"
      && submission.changes.some((change) => change.fields.uuid === topoUuid))).toHaveLength(1);
    expect((await memberApp.mySubmissions()).submissions.map((submission) => submission.id)).not.toContain(submissionId);

    await approveSubmission(admin, submissionId);

    // Published: polling from the same cursor reports the decision and the new ids.
    const { ids } = findSubmission(await app.mySubmissions(before), submissionId, "approved");
    expect(ids).toEqual({ c1: expect.any(Number), s1: expect.any(Number), r1: expect.any(Number), t1: expect.any(Number) });

    // The catalog pulls return the published records under those ids.
    expect(await app.route(ids.r1)).toMatchObject({ id: ids.r1, sectorId: ids.s1 });
    const topo = await app.topo(topoUuid);
    expect(topo).toMatchObject({ id: ids.t1, name: topoName, status: "Active" });
    expect(topo.routes).toEqual([expect.objectContaining({ routeId: ids.r1, label: "1" })]);
  });

  test("only admins publish topos directly, and their edits keep what they leave out", async ({
    page,
    pageAs,
    uniqueName,
  }) => {
    const app = topobuilderApi(page.request, await connectTopobuilder(page));
    const admin = await pageAs("admin");
    const adminApp = topobuilderApi(admin.request, await connectTopobuilder(admin));
    const created = await app.submit(newRouteChanges({ crag: uniqueName("Crag"), route: uniqueName("Route") }));
    await approveSubmission(admin, created);
    const { s1: sectorId, r1: routeId } = (await app.status(created)).ids!;
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
    const created = await app.submit(newRouteChanges({ crag: uniqueName("Crag"), route: uniqueName("Route") }));
    await approveSubmission(admin, created);
    const routeId = (await app.status(created)).ids!.r1;

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
