import type { Kysely } from "kysely";
import { chunk, MAX_IDS_PER_QUERY } from "./audit.server";
import type { DB } from "./db.d";
import { SUBMISSION_FIELDS, type SubmissionEntity, type SubmissionObject } from "./submission.server";
import { fieldLabel } from "./submissionView.server";

/**
 * Conflict checks for pending edits, run when they're reviewed. They inform the
 * reviewer and never block approval. See docs/submissions-review-plan.md.
 */

// An audit row is written just after the change it records, so its created_at
// can trail the updated_at a submitter saw. Rows this close to the base time
// are treated as the submitter's own starting point.
const AUDIT_SLACK_MS = 5_000;

export type FieldConflict = {
  field: string;
  label: string;
  at: string;
  authorName: string | null;
  reviewerName: string | null;
  before: unknown;
  after: unknown;
};

export type Overlap = {
  /** The other pending object, which identifies its chain. */
  item: number;
  submitterName: string | null;
  fields: string[];
};

export type RecordChangedWarning =
  | { kind: "otherFields"; fields: string[] }
  | { kind: "unrecorded"; updatedAt: string };

export type ChangeConflicts = {
  fieldConflicts: FieldConflict[];
  overlaps: Overlap[];
  recordChanged: RecordChangedWarning | null;
};

export type ConflictCounts = { conflicts: number; warnings: number };

/** A pending object from another account, with its submitter's name. */
export type OtherPendingObject = SubmissionObject & { submitterName: string | null };

/** Parses SQLite (`YYYY-MM-DD HH:MM:SS`, UTC) and ISO timestamps to epoch ms. */
export function timestampMs(value: string | null | undefined): number {
  if (!value) return NaN;
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value);
  return Date.parse(sqlite ? `${value.replace(" ", "T")}Z` : value);
}

const FIELDS_BY_COLUMN = Object.fromEntries(
  (Object.keys(SUBMISSION_FIELDS) as SubmissionEntity[]).map((entity) => [
    entity,
    Object.fromEntries(Object.entries(SUBMISSION_FIELDS[entity]).map(([field, spec]) => [spec.column, field])),
  ]),
) as Record<SubmissionEntity, Record<string, string>>;

function fieldName(entity: SubmissionEntity, column: string) {
  return FIELDS_BY_COLUMN[entity][column] ?? column;
}

type AuditRow = {
  entity: string;
  entity_id: number | null;
  created_at: string;
  author_name: string | null;
  reviewer_name: string | null;
  changes: string;
};

async function loadRecentHistory(db: Kysely<DB>, targets: Map<SubmissionEntity, number[]>) {
  const history: AuditRow[] = [];
  const updatedAt = new Map<string, string | null>();

  for (const [entity, ids] of targets) {
    for (const idChunk of chunk([...new Set(ids)], MAX_IDS_PER_QUERY)) {
      const rows = await db.selectFrom("audit_log")
        .select(["entity", "entity_id", "created_at", "author_name", "reviewer_name", "changes"])
        .where("entity", "=", entity)
        .where("entity_id", "in", idChunk)
        // Only changes that were applied.
        .where((eb) => eb.or([eb("decision", "is", null), eb("decision", "=", "approved")]))
        .orderBy("id")
        .execute();
      history.push(...rows);

      const records = await db.selectFrom(entity).select(["id", "updated_at"]).where("id", "in", idChunk).execute();
      for (const record of records) {
        updatedAt.set(`${entity}:${record.id}`, record.updated_at);
      }
    }
  }

  return { history, updatedAt };
}

/**
 * Checks each pending edit against the audit log since the submitter's base time
 * (their `baseUpdatedAt`, or when the proposal arrived) and against other
 * accounts' pending edits. Returns conflicts by object id.
 */
export async function findConflicts(
  db: Kysely<DB>,
  objects: SubmissionObject[],
  others: OtherPendingObject[],
): Promise<Map<number, ChangeConflicts>> {
  const edits = objects.filter((object) => object.targetId !== null);
  const targets = new Map<SubmissionEntity, number[]>();
  for (const edit of edits) {
    targets.set(edit.entity, [...(targets.get(edit.entity) ?? []), edit.targetId!]);
  }

  const { history, updatedAt } = await loadRecentHistory(db, targets);
  const result = new Map<number, ChangeConflicts>();

  for (const edit of edits) {
    const baseMs = Number.isNaN(timestampMs(edit.baseUpdatedAt))
      ? timestampMs(edit.receivedAt)
      : timestampMs(edit.baseUpdatedAt);
    const fields = Object.keys(edit.fields);
    const columns = new Set(fields.map((field) => SUBMISSION_FIELDS[edit.entity][field].column));

    const fieldConflicts: FieldConflict[] = [];
    const otherFields = new Set<string>();
    const since = history.filter((row) => row.entity === edit.entity
      && row.entity_id === edit.targetId
      && timestampMs(row.created_at) > baseMs + AUDIT_SLACK_MS);
    for (const row of since) {
      const changes = JSON.parse(row.changes) as Record<string, [unknown, unknown]>;
      for (const [column, [before, after]] of Object.entries(changes)) {
        const field = fieldName(edit.entity, column);
        if (columns.has(column)) {
          fieldConflicts.push({
            field,
            label: fieldLabel(field),
            at: row.created_at,
            authorName: row.author_name,
            reviewerName: row.reviewer_name,
            before,
            after,
          });
        } else {
          otherFields.add(fieldLabel(field));
        }
      }
    }

    const overlaps: Overlap[] = others
      .filter((other) => other.uid !== edit.uid && other.entity === edit.entity && other.targetId === edit.targetId)
      .map((other) => ({
        item: other.id,
        submitterName: other.submitterName,
        fields: Object.keys(other.fields).filter((field) => fields.includes(field)).map(fieldLabel),
      }))
      .filter((overlap) => overlap.fields.length > 0);

    let recordChanged: RecordChangedWarning | null = null;
    const recordUpdatedAt = updatedAt.get(`${edit.entity}:${edit.targetId}`);
    if (otherFields.size > 0) {
      recordChanged = { kind: "otherFields", fields: [...otherFields] };
    } else if (since.length === 0 && recordUpdatedAt && timestampMs(recordUpdatedAt) > baseMs) {
      recordChanged = { kind: "unrecorded", updatedAt: recordUpdatedAt };
    }

    if (fieldConflicts.length > 0 || overlaps.length > 0 || recordChanged) {
      result.set(edit.id, { fieldConflicts, overlaps, recordChanged });
    }
  }

  return result;
}

export function countConflicts(conflicts: Map<number, ChangeConflicts>): ConflictCounts {
  let count = 0;
  let warnings = 0;
  for (const change of conflicts.values()) {
    count += change.fieldConflicts.length + change.overlaps.length;
    if (change.recordChanged) warnings += 1;
  }
  return { conflicts: count, warnings };
}
