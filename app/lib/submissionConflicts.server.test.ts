import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import type { DB } from "~/lib/db.d";
import type { SubmissionPayload } from "./submission.server";
import { countConflicts, findConflicts, timestampMs } from "./submissionConflicts.server";

const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (path: string) =>
  SqliteDatabase & Pick<DatabaseSync, "exec">;

const BASE = "2026-10-01 10:00:00";

const edit = (fields: Record<string, unknown>, baseUpdatedAt: string | null = BASE): SubmissionPayload => ({
  changes: [{ entity: "route", op: "update", id: 100, ...(baseUpdatedAt ? { baseUpdatedAt } : {}), fields }],
});

describe("submission conflicts", () => {
  let sqlite: InstanceType<typeof Sqlite>;
  let db: Kysely<DB>;

  function logChange(createdAt: string, changes: Record<string, [unknown, unknown]>, extra = "NULL, NULL, NULL") {
    sqlite.exec(`
      INSERT INTO audit_log (created_at, author_name, source, entity, entity_id, action, changes, decision, reviewer_name, submission_id)
      VALUES ('${createdAt}', 'Alex', 'web', 'route', 100, 'update', '${JSON.stringify(changes)}', ${extra});
    `);
  }

  const check = (payload: SubmissionPayload, others: Parameters<typeof findConflicts>[2] = []) =>
    findConflicts(db, { id: "mine", createdAt: "2026-10-01 09:00:00", payload }, others);

  beforeEach(() => {
    sqlite = new Sqlite(":memory:");
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    sqlite.exec(readFileSync(resolve("migrations", "0002_initial_setup.sql"), "utf8"));
    sqlite.exec("ALTER TABLE route ADD COLUMN updated_at TIMESTAMP");
    sqlite.exec(readFileSync(resolve("migrations", "0070_add_audit_log.sql"), "utf8"));
    sqlite.exec(`
      INSERT INTO crag (id, name) VALUES (1, 'Crag');
      INSERT INTO sector (id, name, crag_id) VALUES (10, 'Sector', 1);
      INSERT INTO route (id, name, sector_id, grade_yds, updated_at) VALUES (100, 'Route', 10, '5.10c', '${BASE}');
    `);
  });

  it("finds a field conflict from an applied change made after the submitter last saw the record", async () => {
    logChange("2026-10-02 08:30:00", { grade_yds: ["5.10b", "5.10c"] });

    const conflicts = await check(edit({ gradeYds: "5.10a" }));

    expect(conflicts.get(0)).toEqual({
      fieldConflicts: [{
        field: "gradeYds",
        label: "Grade",
        at: "2026-10-02 08:30:00",
        authorName: "Alex",
        reviewerName: null,
        before: "5.10b",
        after: "5.10c",
      }],
      overlaps: [],
      recordChanged: null,
    });
    expect(countConflicts(conflicts)).toEqual({ conflicts: 1, warnings: 0 });
  });

  it("ignores rejected changes, this submission's own changes, and rows at the submitter's starting point", async () => {
    logChange("2026-10-02 08:30:00", { grade_yds: ["5.10b", "5.10d"] }, "'rejected', 'Admin', 'other'");
    logChange("2026-10-02 08:31:00", { grade_yds: ["5.10b", "5.10c"] }, "'approved', 'Admin', 'mine'");
    logChange("2026-10-01 10:00:02", { grade_yds: ["5.10b", "5.10c"] });

    expect(await check(edit({ gradeYds: "5.10a" }))).toEqual(new Map());
  });

  it("flags another queued submission editing the same field, whatever its value", async () => {
    const others = [
      { id: "theirs", createdAt: BASE, submitterName: "Sam", payload: edit({ gradeYds: "5.10a", boltCount: 7 }) },
      { id: "unrelated", createdAt: BASE, submitterName: "Kim", payload: edit({ name: "Renamed" }) },
    ];

    const conflicts = await check(edit({ gradeYds: "5.10a", status: "Active" }), others);

    expect(conflicts.get(0)?.overlaps).toEqual([{ submissionId: "theirs", submitterName: "Sam", fields: ["Grade"] }]);
    expect(conflicts.get(0)?.fieldConflicts).toEqual([]);
  });

  it("warns when the record changed only on other fields", async () => {
    logChange("2026-10-02 08:30:00", { name: ["Route", "Renamed"] });

    const conflicts = await check(edit({ gradeYds: "5.10a" }));

    expect(conflicts.get(0)).toEqual({
      fieldConflicts: [],
      overlaps: [],
      recordChanged: { kind: "otherFields", fields: ["Name"] },
    });
    expect(countConflicts(conflicts)).toEqual({ conflicts: 0, warnings: 1 });
  });

  it("warns when the record is newer but the audit log doesn't say why", async () => {
    sqlite.exec("UPDATE route SET updated_at = '2026-10-03 12:00:00' WHERE id = 100");

    expect((await check(edit({ gradeYds: "5.10a" }))).get(0)?.recordChanged)
      .toEqual({ kind: "unrecorded", updatedAt: "2026-10-03 12:00:00" });
  });

  it("uses the submission time when no base time was sent", async () => {
    logChange("2026-10-01 09:30:00", { grade_yds: ["5.10b", "5.10c"] });

    expect((await check(edit({ gradeYds: "5.10a" }, null))).get(0)?.fieldConflicts).toHaveLength(1);
    expect(await check(edit({ gradeYds: "5.10a" }))).toEqual(new Map());
  });

  it("compares ISO and SQLite timestamps as UTC", async () => {
    expect(timestampMs("2026-10-01 10:00:00")).toBe(timestampMs("2026-10-01T10:00:00.000Z"));
    sqlite.exec("UPDATE route SET updated_at = '2026-10-01T11:00:00.000Z' WHERE id = 100");

    expect((await check(edit({ gradeYds: "5.10a" }, "2026-10-01T10:00:00.000Z"))).get(0)?.recordChanged)
      .toEqual({ kind: "unrecorded", updatedAt: "2026-10-01T11:00:00.000Z" });
  });

  it("doesn't check creates", async () => {
    const conflicts = await check({ changes: [{ entity: "route", op: "create", fields: { name: "New", sectorId: 10 } }] });

    expect(conflicts).toEqual(new Map());
  });
});
