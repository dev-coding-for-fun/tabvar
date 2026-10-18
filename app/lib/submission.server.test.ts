import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import { createContext } from "~/test/helpers";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  uploadFileToR2: vi.fn(),
  deleteFromR2: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  getDB: mocks.getDB,
}));

vi.mock("~/lib/s3.server", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
  deleteFromR2: mocks.deleteFromR2,
}));

import {
  createSubmission,
  getSubmissionStatus,
  listMySubmissions,
  parseSubmissionRequest,
  SubmissionValidationError,
} from "./submission.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const image = (name: string, type = "image/jpeg") => new File(["image-bytes"], name, { type });

const fullSubmission = {
  changes: [
    { ref: "c1", entity: "crag", op: "create", fields: { name: "New Crag" } },
    { ref: "s1", entity: "sector", op: "create", fields: { name: "Main Wall", cragId: "c1" } },
    { ref: "r1", entity: "route", op: "create", fields: { name: "New Line", sectorId: "s1", gradeYds: "5.11a" } },
    { entity: "route", op: "update", id: 100, baseUpdatedAt: "2026-06-09 10:00:00", fields: { boltCount: 7, notes: null } },
    {
      entity: "topo",
      op: "create",
      fields: {
        uuid: "topo-new",
        name: "Main Wall Left",
        sectorId: "s1",
        background: "file:bg",
        raster: "file:raster",
        annotations: { version: 1, items: [] },
        routes: [{ routeId: 100, label: "1" }, { routeId: "r1", label: "2", sortOrder: 2 }],
      },
    },
  ],
};

describe("submission intake", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;
  const files = () => new Map([["bg", image("bg.jpg")], ["raster", image("raster.png", "image/png")]]);

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    for (const migration of ["0062_add_raw_topos.sql", "0070_add_audit_log.sql", "0071_replace_topo_submission.sql"]) {
      sqlite.exec(readFileSync(resolve("migrations", migration), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO user (uid, display_name) VALUES ('submitter', 'Submitter'), ('someone-else', 'Other');
      INSERT INTO crag (id, name) VALUES (1, 'Crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1);
      INSERT INTO route (id, name, sector_id) VALUES (100, 'Route', 10);
      INSERT INTO topo (id, uuid, name, background_image_url, raster_image_url) VALUES (7, 'topo-existing', 'Topo', 'bg.jpg', 'raster.jpg');
    `);
    mocks.getDB.mockReturnValue(db);
    mocks.uploadFileToR2.mockImplementation(async (_context, file: File, _bucket, domain: string, options) => ({
      url: `${domain}/${options.keyPrefix}/${file.name}`,
      name: `${options.keyPrefix}/${file.name}`,
      type: file.type,
    }));
  });

  async function storedPayload() {
    const { payload } = await db.selectFrom("submission").select("payload").executeTakeFirstOrThrow();
    return { raw: payload, parsed: JSON.parse(payload) };
  }

  it("queues a multi-level submission and stores uploaded file URLs in place of placeholders", async () => {
    const result = await createSubmission(createContext(), {
      uid: "submitter",
      source: "topobuilder",
      payload: fullSubmission,
      files: files(),
    });

    expect(result).toEqual({ id: expect.any(String), status: "pending" });
    const row = await db.selectFrom("submission").selectAll().executeTakeFirstOrThrow();
    expect(row).toEqual(expect.objectContaining({ id: result.id, uid: "submitter", source: "topobuilder", error: null }));

    const topo = (await storedPayload()).parsed.changes[4];
    expect(topo.fields.background).toBe(`https://topos.example.com/submissions/${result.id}/bg.jpg`);
    expect(topo.fields.raster).toBe(`https://topos.example.com/submissions/${result.id}/raster.png`);
    expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(2);
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith(
      expect.anything(), expect.any(File), "topos", "https://topos.example.com",
      { keyPrefix: `submissions/${result.id}`, useContentHash: true },
    );
  });

  it("stores text containing HTML entities so the DB's entity decoding can't alter it", async () => {
    await createSubmission(createContext(), {
      uid: "submitter",
      source: "topobuilder",
      payload: { changes: [{ entity: "route", op: "update", id: 100, fields: { notes: '<p>Tom &amp; "Jerry" &quot;</p>' } }] },
      files: new Map(),
    });

    const { raw, parsed } = await storedPayload();
    expect(raw).not.toContain("&");
    expect(parsed.changes[0].fields.notes).toBe('<p>Tom &amp; "Jerry" &quot;</p>');
  });

  it.each([
    ["an empty change list", { changes: [] }, "at least one change"],
    ["an unknown entity", { changes: [{ entity: "area", op: "create", fields: {} }] }, "changes[0].entity must be one of"],
    ["a delete", { changes: [{ entity: "route", op: "delete", id: 100, fields: {} }] }, "changes[0].op must be create or update"],
    ["an unknown field", { changes: [{ entity: "route", op: "update", id: 100, fields: { grade: "5.9" } }] }, "changes[0].fields.grade is not an editable route field"],
    ["a wrongly typed field", { changes: [{ entity: "route", op: "update", id: 100, fields: { boltCount: "7" } }] }, "boltCount must be an integer or null"],
    ["clearing a required field", { changes: [{ entity: "route", op: "update", id: 100, fields: { name: null } }] }, "name must be a non-empty string"],
    ["clearing a topo status", { changes: [{ entity: "topo", op: "update", id: 7, fields: { status: null } }] }, "status must be a non-empty string"],
    ["a create missing required fields", { changes: [{ entity: "route", op: "create", fields: { name: "Line" } }] }, "fields.sectorId is required to create a route"],
    ["an empty update", { changes: [{ entity: "route", op: "update", id: 100, fields: {} }] }, "must include at least one field to change"],
    ["a ref to a later create", { changes: [
      { entity: "route", op: "create", fields: { name: "Line", sectorId: "s1" } },
      { ref: "s1", entity: "sector", op: "create", fields: { name: "Wall", cragId: 1 } },
    ] }, 'changes[0].fields.sectorId refers to "s1"'],
    ["a ref to the wrong kind of record", { changes: [
      { ref: "c1", entity: "crag", op: "create", fields: { name: "Crag" } },
      { entity: "route", op: "create", fields: { name: "Line", sectorId: "c1" } },
    ] }, "not the ref of an earlier sector create"],
    ["a duplicate ref", { changes: [
      { ref: "c1", entity: "crag", op: "create", fields: { name: "A" } },
      { ref: "c1", entity: "crag", op: "create", fields: { name: "B" } },
    ] }, 'ref "c1" is already used'],
    ["a missing file part", { changes: [{ entity: "topo", op: "update", id: 7, fields: { raster: "file:nope" } }] }, 'missing file part "nope"'],
    ["a file value that isn't a placeholder", { changes: [{ entity: "topo", op: "update", id: 7, fields: { raster: "https://elsewhere/x.jpg" } }] }, "reference to an uploaded file"],
    ["an annotation document without items", { changes: [{ entity: "topo", op: "update", id: 7, fields: { annotations: { version: 1 } } }] }, "fields.annotations must be an annotation document"],
    ["a missing update target", { changes: [{ entity: "route", op: "update", id: 999, fields: { name: "X" } }] }, "changes[0].id refers to route 999, which doesn't exist"],
    ["a missing parent", { changes: [{ entity: "route", op: "create", fields: { name: "Line", sectorId: 55 } }] }, "fields.sectorId refers to sector 55"],
    ["a missing linked route", { changes: [{ entity: "topo", op: "update", id: 7, fields: { routes: [{ routeId: 404 }] } }] }, "routes[0].routeId refers to route 404"],
    ["a topo create reusing an existing uuid", { changes: [{ entity: "topo", op: "create", fields: {
      uuid: "topo-existing", name: "Again", background: "file:bg", raster: "file:raster",
    } }] }, '"topo-existing" belongs to an existing topo'],
    ["a topo uuid change", { changes: [{ entity: "topo", op: "update", id: 7, fields: { uuid: "other" } }] }, "fields.uuid can't be changed"],
  ])("rejects %s", async (_label, payload, message) => {
    const attempt = createSubmission(createContext(), { uid: "submitter", source: "topobuilder", payload, files: files() });

    await expect(attempt).rejects.toBeInstanceOf(SubmissionValidationError);
    await expect(attempt).rejects.toThrow(message);
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled();
    expect(await db.selectFrom("submission").select("id").execute()).toEqual([]);
  });

  it("rejects files that aren't images", async () => {
    const attempt = createSubmission(createContext(), {
      uid: "submitter",
      source: "topobuilder",
      payload: { changes: [{ entity: "topo", op: "update", id: 7, fields: { raster: "file:raster" } }] },
      files: new Map([["raster", image("raster.pdf", "application/pdf")]]),
    });

    await expect(attempt).rejects.toThrow('unsupported file type "application/pdf"');
  });

  it("removes uploaded files when the submission can't be stored", async () => {
    const attempt = createSubmission(createContext(), {
      uid: "no-such-user",
      source: "topobuilder",
      payload: fullSubmission,
      files: files(),
    });

    await expect(attempt).rejects.toThrow("FOREIGN KEY");
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(2);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(expect.anything(), "topos", expect.stringMatching(/^submissions\/.+\/bg\.jpg$/));
  });

  it("reads a JSON body or a multipart submission with file parts", async () => {
    const json = await parseSubmissionRequest(new Request("https://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    }));
    expect(json).toEqual({ payload: { changes: [] }, files: new Map() });

    const formData = new FormData();
    formData.append("submission", JSON.stringify(fullSubmission));
    formData.append("bg", image("bg.jpg"));
    const multipart = await parseSubmissionRequest(new Request("https://example.com", { method: "POST", body: formData }));
    expect(multipart.payload).toEqual(fullSubmission);
    expect([...multipart.files.keys()]).toEqual(["bg"]);

    await expect(parseSubmissionRequest(new Request("https://example.com", { method: "POST", body: "{nope" })))
      .rejects.toThrow("must be valid JSON");
  });

  describe("status", () => {
    it("reports a queued submission, with any approval error, only to its submitter", async () => {
      sqlite.exec(`INSERT INTO submission (id, uid, source, payload, error) VALUES ('queued', 'submitter', 'topobuilder', '{}', 'Route 100 is gone')`);

      expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "queued" }))
        .toEqual({ id: "queued", status: "pending", error: "Route 100 is gone" });
      expect(await getSubmissionStatus(createContext(), { uid: "someone-else", id: "queued" })).toBeNull();
      expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "unknown" })).toBeNull();
    });

    it("reports a decided submission and its created ids from the audit log", async () => {
      sqlite.exec(`
        INSERT INTO audit_log (author_uid, reviewer_uid, decision, source, entity, entity_id, action, changes, submission_id, ref) VALUES
          ('submitter', 'admin', 'approved', 'topobuilder', 'sector', 21, 'create', '{}', 'done', 's1'),
          ('submitter', 'admin', 'approved', 'topobuilder', 'route', 100, 'update', '{}', 'done', NULL),
          ('submitter', 'admin', 'approved', 'topobuilder', 'route', 301, 'create', '{}', 'done', 'r1'),
          ('submitter', 'admin', 'rejected', 'topobuilder', 'route', NULL, 'create', '{}', 'declined', 'r1');
      `);

      expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "done" }))
        .toEqual({ id: "done", status: "approved", ids: { s1: 21, r1: 301 } });
      expect(await getSubmissionStatus(createContext(), { uid: "submitter", id: "declined" }))
        .toEqual({ id: "declined", status: "rejected", ids: {} });
      expect(await getSubmissionStatus(createContext(), { uid: "someone-else", id: "done" })).toBeNull();
    });
  });

  describe("my submissions", () => {
    const change = { entity: "route", op: "update", id: 100, fields: { boltCount: 7 } };

    beforeEach(() => {
      sqlite.exec(`
        INSERT INTO submission (id, uid, source, payload, created_at, error) VALUES
          ('older', 'submitter', 'topobuilder', '${JSON.stringify({ changes: [change] })}', '2026-10-01 09:00:00', NULL),
          ('newer', 'submitter', 'topobuilder', '${JSON.stringify({ changes: [change] })}', '2026-10-02 09:00:00', 'route 100 is gone'),
          ('theirs', 'someone-else', 'topobuilder', '{"changes":[]}', '2026-10-02 09:00:00', NULL);
        INSERT INTO audit_log (author_uid, reviewer_uid, decision, source, entity, entity_id, action, changes, submission_id, ref, created_at) VALUES
          ('submitter', 'admin', 'approved', 'topobuilder', 'sector', 21, 'create', '{}', 'done', 's1', '2026-10-03 10:00:00'),
          ('submitter', 'admin', 'approved', 'topobuilder', 'route', 301, 'create', '{}', 'done', 'r1', '2026-10-03 10:00:01'),
          ('submitter', 'admin', 'rejected', 'topobuilder', 'route', NULL, 'create', '{}', 'declined', 'r1', '2026-10-04 10:00:00'),
          ('submitter', 'admin', 'approved', 'topobuilder', 'crag', 5, 'create', '{}', 'newer', 'c1', '2026-10-02 10:00:00'),
          ('someone-else', 'admin', 'approved', 'topobuilder', 'route', 9, 'create', '{}', 'other', 'r1', '2026-10-05 10:00:00');
      `);
    });

    it("lists the caller's queued submissions with their changes, and decided ones from the audit log", async () => {
      const list = await listMySubmissions(createContext(), { uid: "submitter", since: null });

      expect(list.submissions).toEqual([
        { id: "newer", submitterUid: "submitter", status: "pending", createdAt: "2026-10-02 09:00:00", error: "route 100 is gone", changes: [change] },
        { id: "older", submitterUid: "submitter", status: "pending", createdAt: "2026-10-01 09:00:00", error: null, changes: [change] },
        { id: "done", submitterUid: "submitter", status: "approved", decidedAt: "2026-10-03 10:00:01", ids: { s1: 21, r1: 301 } },
        { id: "declined", submitterUid: "submitter", status: "rejected", decidedAt: "2026-10-04 10:00:00", ids: {} },
      ]);
      expect(list.serverTime).toBe("2026-10-04 10:00:00");
    });

    it("reports decisions since the cursor in full, and always every queued submission", async () => {
      const list = await listMySubmissions(createContext(), { uid: "submitter", since: "2026-10-03 10:00:01" });

      expect(list.submissions.map((submission) => [submission.id, submission.status])).toEqual([
        ["newer", "pending"], ["older", "pending"], ["done", "approved"], ["declined", "rejected"],
      ]);
      // The cursor fell between this submission's audit rows; its ids are still complete.
      expect(list.submissions.find((submission) => submission.id === "done")).toMatchObject({ ids: { s1: 21, r1: 301 } });
    });

    it("returns only queued submissions when nothing was decided since the cursor", async () => {
      const list = await listMySubmissions(createContext(), { uid: "submitter", since: "2026-10-04 10:00:01" });

      expect(list.submissions.map((submission) => submission.id)).toEqual(["newer", "older"]);
      expect(list.serverTime).toBe("2026-10-04 10:00:01");
    });

    it("never includes other users' submissions", async () => {
      const list = await listMySubmissions(createContext(), { uid: "someone-else", since: null });

      expect(list.submissions.map((submission) => submission.id)).toEqual(["theirs", "other"]);
    });
  });
});
