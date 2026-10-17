import type { Kysely } from "kysely";
import type { AppLoadContext } from "react-router";
import { getDB } from "./db";
import { toStoredJson } from "./storedJson";
import type { DB } from "./db.d";
import type { User } from "./models";

/**
 * Audit log for crag, sector, route, and topo changes. It is the only history
 * of route data and is read by hand (SQL on /admin/query) when tracing a change.
 * See docs/submissions-review-plan.md.
 */

export type AuditEntity = "crag" | "sector" | "route" | "topo";
export type AuditAction = "create" | "update" | "delete";
export type AuditActor = Pick<User, "uid" | "displayName">;
export type AuditChanges = Record<string, [unknown, unknown]>;
type AuditRow = Record<string, unknown>;

export type AuditEntry = {
  author: AuditActor | null;
  reviewer?: AuditActor | null;
  decision?: "approved" | "rejected" | null;
  source: string;
  entity: AuditEntity;
  entityId: number | null;
  action: AuditAction;
  changes: AuditChanges;
  submissionId?: string | null;
  ref?: string | null;
};

// Columns compared for creates and updates. Timestamps, issue counters, and
// denormalized names are left out because triggers maintain them. A topo's
// route links are compared as a `routes` list.
const AUDITED_COLUMNS: Record<AuditEntity, readonly string[]> = {
  crag: ["name", "slug", "notes", "latitude", "longitude"],
  sector: ["name", "crag_id", "notes", "latitude", "longitude", "sort_order"],
  route: [
    "name", "alt_names", "sector_id", "grade_yds", "climb_style", "bolt_count", "pitch_count",
    "route_length", "first_ascent_by", "first_ascent_date", "route_built_date", "year", "status",
    "notes", "sort_order", "latitude", "longitude",
  ],
  topo: [
    "uuid", "name", "description", "crag_id", "sector_id", "latitude", "longitude", "status",
    "background_image_url", "raster_image_url", "annotations_json", "routes",
  ],
};

// D1 allows at most 100 bound parameters per query.
const MAX_IDS_PER_QUERY = 90;
const AUDIT_COLUMN_COUNT = 12;
const MAX_ENTRIES_PER_INSERT = Math.floor(100 / AUDIT_COLUMN_COUNT);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sameValue(a: unknown, b: unknown) {
  if (a === b) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Loads full rows for the given ids, keyed by id. Topos include their route links. */
export async function loadAuditRows(
  db: Kysely<DB>,
  entity: AuditEntity,
  ids: number[],
): Promise<Map<number, AuditRow>> {
  const rowsById = new Map<number, AuditRow>();
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return rowsById;

  for (const idChunk of chunk(uniqueIds, MAX_IDS_PER_QUERY)) {
    const rows = await db.selectFrom(entity).selectAll().where("id", "in", idChunk).execute();
    for (const row of rows as AuditRow[]) {
      rowsById.set(Number(row.id), { ...row });
    }
  }

  if (entity === "topo") {
    for (const idChunk of chunk([...rowsById.keys()], MAX_IDS_PER_QUERY)) {
      const links = await db
        .selectFrom("route_topo")
        .select(["topo_id", "route_id", "label", "sort_order"])
        .where("topo_id", "in", idChunk)
        .orderBy("topo_id")
        .orderBy("sort_order")
        .execute();
      for (const id of idChunk) {
        rowsById.get(id)!.routes = links
          .filter((link) => link.topo_id === id)
          .map(({ route_id, label, sort_order }) => ({ route_id, label, sort_order }));
      }
    }
  }

  return rowsById;
}

/**
 * Describes the change between two snapshots of one row, or null when nothing
 * audited changed. A missing `before` is a create; a missing `after` is a delete,
 * which records the whole row so it can be rebuilt.
 */
export function describeChange(
  entity: AuditEntity,
  before: AuditRow | undefined,
  after: AuditRow | undefined,
): { action: AuditAction; changes: AuditChanges } | null {
  if (!after) {
    if (!before) return null;
    return {
      action: "delete",
      changes: Object.fromEntries(Object.entries(before).map(([column, value]) => [column, [value, null]])),
    };
  }

  const changes: AuditChanges = {};
  for (const column of AUDITED_COLUMNS[entity]) {
    const from = before ? before[column] ?? null : null;
    const to = after[column] ?? null;
    if (!sameValue(from, to)) {
      changes[column] = [from, to];
    }
  }

  if (Object.keys(changes).length === 0) return null;
  return { action: before ? "update" : "create", changes };
}

export async function writeAudit(db: Kysely<DB>, entries: AuditEntry[]) {
  for (const entryChunk of chunk(entries, MAX_ENTRIES_PER_INSERT)) {
    await insertAuditEntries(db, entryChunk);
  }
}

async function insertAuditEntries(db: Kysely<DB>, entries: AuditEntry[]) {
  await db
    .insertInto("audit_log")
    .values(entries.map((entry) => ({
      author_uid: entry.author?.uid ?? null,
      author_name: entry.author?.displayName ?? null,
      reviewer_uid: entry.reviewer?.uid ?? null,
      reviewer_name: entry.reviewer?.displayName ?? null,
      decision: entry.decision ?? null,
      source: entry.source,
      entity: entry.entity,
      entity_id: entry.entityId,
      action: entry.action,
      changes: toStoredJson(entry.changes),
      submission_id: entry.submissionId ?? null,
      ref: entry.ref ?? null,
    })))
    .execute();
}

/** Logs rows that a direct write already created, for writes that create records as a side effect. */
export async function auditCreatedRows(
  context: AppLoadContext,
  { author, source, entity, ids }: { author: AuditActor; source: string; entity: AuditEntity; ids: number[] },
) {
  const db = getDB(context);
  const rows = await loadAuditRows(db, entity, ids);
  const entries: AuditEntry[] = [];
  for (const [id, row] of rows) {
    const described = describeChange(entity, undefined, row);
    if (described) {
      entries.push({ author, source, entity, entityId: id, ...described });
    }
  }
  await writeAudit(db, entries);
}

export type DirectWrite<T> = {
  author: AuditActor;
  source: string;
  entity: AuditEntity;
  /** Existing rows the write may change or delete. */
  ids: number[];
  write: () => Promise<T>;
  /** Defaults to true. Nothing is logged for a failed write. */
  succeeded?: (result: T) => boolean;
  /** Rows the write created. */
  createdIds?: (result: T) => number[];
};

/**
 * Runs a direct (unreviewed) write and logs a row for each record it created,
 * changed, or deleted, by comparing snapshots taken before and after.
 */
export async function auditedWrite<T>(context: AppLoadContext, change: DirectWrite<T>): Promise<T> {
  const db = getDB(context);
  const before = await loadAuditRows(db, change.entity, change.ids);
  const result = await change.write();

  if (change.succeeded && !change.succeeded(result)) {
    return result;
  }

  const ids = [...new Set([...change.ids, ...(change.createdIds?.(result) ?? [])])];
  const after = await loadAuditRows(db, change.entity, ids);
  const entries: AuditEntry[] = [];
  for (const id of ids) {
    const described = describeChange(change.entity, before.get(id), after.get(id));
    if (described) {
      entries.push({
        author: change.author,
        source: change.source,
        entity: change.entity,
        entityId: id,
        ...described,
      });
    }
  }

  await writeAudit(db, entries);
  return result;
}
