import type { Insertable, Kysely, Updateable } from "kysely";
import type { AppLoadContext } from "react-router";
import {
  describeChange,
  loadAuditRows,
  writeAudit,
  type AuditActor,
  type AuditChanges,
  type AuditEntry,
} from "./audit.server";
import { getDB } from "./db";
import type { DB } from "./db.d";
import { slugifyUnique } from "./slug";
import { toStoredJson } from "./storedJson";
import {
  SUBMISSION_FIELDS,
  type SubmissionChange,
  type SubmissionEntity,
  type SubmissionPayload,
  type SubmissionTopoRoute,
} from "./submission.server";
import { saveRawTopo, type SaveRawTopoPayload } from "./topo.server";

/**
 * Approval and rejection of queued submissions. Each applied or rejected change
 * writes an audit row; the submission row is deleted once it's decided.
 * See docs/submissions-review-plan.md.
 */

export type ReviewResult =
  | { ok: true; ids: Record<string, number> }
  | { ok: false; error: string };

type QueuedSubmission = {
  id: string;
  uid: string;
  source: string;
  payload: SubmissionPayload;
  author: AuditActor;
};

class SubmissionApplyError extends Error {}

async function loadQueuedSubmission(db: Kysely<DB>, id: string): Promise<QueuedSubmission | null> {
  const row = await db.selectFrom("submission")
    .leftJoin("user", "submission.uid", "user.uid")
    .select(["submission.id", "submission.uid", "submission.source", "submission.payload", "user.display_name"])
    .where("submission.id", "=", id)
    .executeTakeFirst();
  if (!row) return null;

  return {
    id: row.id,
    uid: row.uid,
    source: row.source,
    payload: JSON.parse(row.payload) as SubmissionPayload,
    author: { uid: row.uid, displayName: row.display_name },
  };
}

function resolveRef(value: unknown, refIds: Map<string, number>): unknown {
  if (typeof value !== "string") return value;
  const id = refIds.get(value);
  if (id === undefined) {
    throw new SubmissionApplyError(`The record created as "${value}" isn't available.`);
  }
  return id;
}

/** Maps a change's fields to columns, replacing refs with the ids created for them. */
function toColumns(change: SubmissionChange, refIds: Map<string, number>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(change.fields)) {
    const spec = SUBMISSION_FIELDS[change.entity][name];
    columns[spec.column] = spec.kind === "parent" || spec.kind === "optionalParent"
      ? resolveRef(value, refIds)
      : value;
  }
  return columns;
}

function topoRoutes(change: SubmissionChange, refIds: Map<string, number>) {
  const routes = change.fields.routes as SubmissionTopoRoute[] | undefined;
  return routes?.map((link) => ({
    routeId: resolveRef(link.routeId, refIds) as number,
    label: link.label ?? null,
    ...(link.sortOrder !== undefined ? { sortOrder: link.sortOrder } : {}),
  }));
}

async function insertRecord(db: Kysely<DB>, entity: Exclude<SubmissionEntity, "topo">, values: Record<string, unknown>) {
  switch (entity) {
    case "crag": {
      const slug = await slugifyUnique(db, String(values.name));
      const row = await db.insertInto("crag")
        .values({ ...values, slug } as Insertable<DB["crag"]>)
        .returning("id")
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }
    case "sector": {
      const row = await db.insertInto("sector")
        .values(values as Insertable<DB["sector"]>)
        .returning("id")
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }
    case "route": {
      const row = await db.insertInto("route")
        .values(values as Insertable<DB["route"]>)
        .returning("id")
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }
  }
}

async function updateRecord(db: Kysely<DB>, entity: Exclude<SubmissionEntity, "topo">, id: number, values: Record<string, unknown>) {
  switch (entity) {
    case "crag":
      await db.updateTable("crag").set(values as Updateable<DB["crag"]>).where("id", "=", id).execute();
      return;
    case "sector":
      await db.updateTable("sector").set(values as Updateable<DB["sector"]>).where("id", "=", id).execute();
      return;
    case "route":
      await db.updateTable("route").set(values as Updateable<DB["route"]>).where("id", "=", id).execute();
      return;
  }
}

async function saveTopo(
  context: AppLoadContext,
  submission: QueuedSubmission,
  change: SubmissionChange,
  existingName: string | undefined,
  refIds: Map<string, number>,
) {
  const columns = toColumns(change, refIds);
  const fields = change.fields;
  const payload: SaveRawTopoPayload = {
    ...(change.op === "update" ? { id: change.id } : {}),
    ...(typeof fields.uuid === "string" ? { uuid: fields.uuid } : {}),
    // saveRawTopo requires a name; an update that doesn't rename keeps the current one.
    name: (fields.name as string | undefined) ?? existingName ?? "",
    ...("description" in fields ? { description: fields.description as string | null } : {}),
    ...("cragId" in fields ? { cragId: columns.crag_id as number | null } : {}),
    ...("sectorId" in fields ? { sectorId: columns.sector_id as number | null } : {}),
    ...("latitude" in fields ? { latitude: fields.latitude as number | null } : {}),
    ...("longitude" in fields ? { longitude: fields.longitude as number | null } : {}),
    ...("status" in fields ? { status: fields.status as string } : {}),
    ...("background" in fields ? { backgroundUrl: fields.background as string } : {}),
    ...("raster" in fields ? { rasterUrl: fields.raster as string } : {}),
    ...("annotations" in fields ? { annotations: fields.annotations as SaveRawTopoPayload["annotations"] } : {}),
    ...("routes" in fields ? { routes: topoRoutes(change, refIds) } : {}),
  };
  const topo = await saveRawTopo(context, { uid: submission.uid, payload });
  return topo.id;
}

async function applyChange(
  context: AppLoadContext,
  db: Kysely<DB>,
  submission: QueuedSubmission,
  change: SubmissionChange,
  refIds: Map<string, number>,
): Promise<{ id: number; changes: AuditChanges | null }> {
  const before = change.op === "update"
    ? (await loadAuditRows(db, change.entity, [change.id!])).get(change.id!)
    : undefined;
  if (change.op === "update" && !before) {
    throw new SubmissionApplyError(`${change.entity} ${change.id} no longer exists.`);
  }

  let id: number;
  if (change.entity === "topo") {
    id = await saveTopo(context, submission, change, before?.name as string | undefined, refIds);
  } else if (change.op === "create") {
    id = await insertRecord(db, change.entity, toColumns(change, refIds));
  } else {
    id = change.id!;
    await updateRecord(db, change.entity, id, toColumns(change, refIds));
  }

  const after = (await loadAuditRows(db, change.entity, [id])).get(id);
  return { id, changes: describeChange(change.entity, before, after)?.changes ?? null };
}

/**
 * Applies a submission's changes in order and deletes it. If a change fails, the
 * submission stays queued with the error and the ids created so far, so approving
 * again continues without repeating creates.
 */
export async function approveSubmission(
  context: AppLoadContext,
  { id, reviewer }: { id: string; reviewer: AuditActor },
): Promise<ReviewResult> {
  const db = getDB(context);
  const submission = await loadQueuedSubmission(db, id);
  if (!submission) {
    return { ok: false, error: "This submission has already been decided or doesn't exist." };
  }

  const refIds = new Map<string, number>();
  for (const change of submission.payload.changes) {
    if (change.op === "create" && change.ref && change.id) {
      refIds.set(change.ref, change.id);
    }
  }

  try {
    for (const change of submission.payload.changes) {
      if (change.applied) continue;

      const applied = await applyChange(context, db, submission, change, refIds);
      if (change.op === "create") {
        change.id = applied.id;
        if (change.ref) refIds.set(change.ref, applied.id);
      }

      // Written even when nothing changed, so every approved change has a row and the
      // submitter's status lookup can find the decision.
      await writeAudit(db, [{
        author: submission.author,
        reviewer,
        decision: "approved",
        source: submission.source,
        entity: change.entity,
        entityId: applied.id,
        action: change.op,
        changes: applied.changes ?? {},
        submissionId: id,
        ref: change.ref ?? null,
      }]);
      change.applied = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Approving submission ${id} failed:`, error);
    await db.updateTable("submission")
      .set({ payload: toStoredJson(submission.payload), error: message })
      .where("id", "=", id)
      .execute();
    return { ok: false, error: message };
  }

  await db.deleteFrom("submission").where("id", "=", id).execute();
  return { ok: true, ids: Object.fromEntries(refIds) };
}

/** Records each change not yet applied as rejected in the audit log, then deletes the submission. */
export async function rejectSubmission(
  context: AppLoadContext,
  { id, reviewer }: { id: string; reviewer: AuditActor },
): Promise<ReviewResult> {
  const db = getDB(context);
  const submission = await loadQueuedSubmission(db, id);
  if (!submission) {
    return { ok: false, error: "This submission has already been decided or doesn't exist." };
  }

  // Changes applied by an earlier, partly failed approval stay applied.
  const remaining = submission.payload.changes.filter((change) => !change.applied);
  const entries: AuditEntry[] = [];
  for (const change of remaining) {
    const current = change.op === "update"
      ? (await loadAuditRows(db, change.entity, [change.id!])).get(change.id!)
      : undefined;
    const changes: AuditChanges = {};
    for (const [name, value] of Object.entries(change.fields)) {
      const column = SUBMISSION_FIELDS[change.entity][name].column;
      changes[column] = [current?.[column] ?? null, value];
    }
    entries.push({
      author: submission.author,
      reviewer,
      decision: "rejected",
      source: submission.source,
      entity: change.entity,
      entityId: change.op === "update" ? change.id! : null,
      action: change.op,
      changes,
      submissionId: id,
      ref: change.ref ?? null,
    });
  }

  await writeAudit(db, entries);
  await db.deleteFrom("submission").where("id", "=", id).execute();
  return { ok: true, ids: {} };
}
