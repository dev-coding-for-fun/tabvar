import type { Kysely } from "kysely";
import type { DB } from "./db.d";
import { SUBMISSION_FIELDS, type SubmissionEntity, type SubmissionPayload } from "./submission.server";
import { fieldLabel } from "./submissionView.server";

/**
 * Conflict checks for queued submissions, run when one is reviewed. They inform
 * the reviewer and never block approval. See docs/submissions-review-plan.md.
 */

// An audit row is written just after the change it records, so its created_at
// can trail the updated_at a submitter saw. Rows this close to the base time
// are treated as the submitter's own starting point.
const AUDIT_SLACK_MS = 5_000;
// D1 allows at most 100 bound parameters per query.
const MAX_IDS_PER_QUERY = 90;

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
  submissionId: string;
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

type QueuedSubmission = { id: string; createdAt: string; payload: SubmissionPayload };
type OtherSubmission = QueuedSubmission & { submitterName: string | null };

/** Parses SQLite (`YYYY-MM-DD HH:MM:SS`, UTC) and ISO timestamps to epoch ms. */
export function timestampMs(value: string | null | undefined): number {
  if (!value) return NaN;
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value);
  return Date.parse(sqlite ? `${value.replace(" ", "T")}Z` : value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const LABELS_BY_COLUMN = Object.fromEntries(
  (Object.keys(SUBMISSION_FIELDS) as SubmissionEntity[]).map((entity) => [
    entity,
    Object.fromEntries(Object.entries(SUBMISSION_FIELDS[entity]).map(([field, spec]) => [spec.column, field])),
  ]),
) as Record<SubmissionEntity, Record<string, string>>;

function fieldName(entity: SubmissionEntity, column: string) {
  return LABELS_BY_COLUMN[entity][column] ?? column;
}

type AuditRow = {
  entity: string;
  entity_id: number | null;
  created_at: string;
  author_name: string | null;
  reviewer_name: string | null;
  changes: string;
};

async function loadRecentHistory(
  db: Kysely<DB>,
  submissionId: string,
  targets: Map<SubmissionEntity, number[]>,
) {
  const history: AuditRow[] = [];
  const updatedAt = new Map<string, string | null>();

  for (const [entity, ids] of targets) {
    for (const idChunk of chunk([...new Set(ids)], MAX_IDS_PER_QUERY)) {
      const rows = await db.selectFrom("audit_log")
        .select(["entity", "entity_id", "created_at", "author_name", "reviewer_name", "changes"])
        .where("entity", "=", entity)
        .where("entity_id", "in", idChunk)
        // Only applied changes, and not ones this submission made in an earlier, partly failed approval.
        .where((eb) => eb.or([eb("decision", "is", null), eb("decision", "=", "approved")]))
        .where((eb) => eb.or([eb("submission_id", "is", null), eb("submission_id", "!=", submissionId)]))
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
 * Checks each edit in a submission against the audit log since the submitter's
 * base time and against other queued submissions. Returns conflicts by change index.
 */
export async function findConflicts(
  db: Kysely<DB>,
  submission: QueuedSubmission,
  others: OtherSubmission[],
): Promise<Map<number, ChangeConflicts>> {
  const targets = new Map<SubmissionEntity, number[]>();
  submission.payload.changes.forEach((change) => {
    if (change.op !== "update" || !change.id) return;
    targets.set(change.entity, [...(targets.get(change.entity) ?? []), change.id]);
  });

  const { history, updatedAt } = await loadRecentHistory(db, submission.id, targets);
  const result = new Map<number, ChangeConflicts>();

  submission.payload.changes.forEach((change, index) => {
    if (change.op !== "update" || !change.id) return;

    const baseMs = Number.isNaN(timestampMs(change.baseUpdatedAt))
      ? timestampMs(submission.createdAt)
      : timestampMs(change.baseUpdatedAt);
    const fields = Object.keys(change.fields);
    const columns = new Set(fields.map((field) => SUBMISSION_FIELDS[change.entity][field].column));

    const fieldConflicts: FieldConflict[] = [];
    const otherFields = new Set<string>();
    const since = history.filter((row) => row.entity === change.entity
      && row.entity_id === change.id
      && timestampMs(row.created_at) > baseMs + AUDIT_SLACK_MS);
    for (const row of since) {
      const changes = JSON.parse(row.changes) as Record<string, [unknown, unknown]>;
      for (const [column, [before, after]] of Object.entries(changes)) {
        const field = fieldName(change.entity, column);
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

    const overlaps: Overlap[] = [];
    for (const other of others) {
      const shared = new Set<string>();
      for (const otherChange of other.payload.changes) {
        if (otherChange.op !== "update" || otherChange.entity !== change.entity || otherChange.id !== change.id) continue;
        Object.keys(otherChange.fields).filter((field) => fields.includes(field)).forEach((field) => shared.add(field));
      }
      if (shared.size > 0) {
        overlaps.push({ submissionId: other.id, submitterName: other.submitterName, fields: [...shared].map(fieldLabel) });
      }
    }

    let recordChanged: RecordChangedWarning | null = null;
    const recordUpdatedAt = updatedAt.get(`${change.entity}:${change.id}`);
    if (otherFields.size > 0) {
      recordChanged = { kind: "otherFields", fields: [...otherFields] };
    } else if (since.length === 0 && recordUpdatedAt && timestampMs(recordUpdatedAt) > baseMs) {
      recordChanged = { kind: "unrecorded", updatedAt: recordUpdatedAt };
    }

    if (fieldConflicts.length > 0 || overlaps.length > 0 || recordChanged) {
      result.set(index, { fieldConflicts, overlaps, recordChanged });
    }
  });

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
