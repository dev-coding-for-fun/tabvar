import type { Insertable, Kysely, Updateable } from "kysely";
import type { AppLoadContext } from "react-router";
import {
  chunk,
  describeChange,
  loadAuditRows,
  MAX_IDS_PER_QUERY,
  writeAudit,
  type AuditActor,
  type AuditChanges,
  type AuditEntry,
} from "./audit.server";
import { getDB } from "./db";
import type { DB } from "./db.d";
import { slugifyUnique } from "./slug";
import {
  mapReferences,
  sortParentsFirst,
  SUBMISSION_FIELDS,
  toSubmissionObject,
  type SubmissionEntity,
  type SubmissionObject,
  type SubmissionTopoRoute,
} from "./submission.server";
import { saveRawTopo, type SaveRawTopoPayload, type TopoStatus } from "./topo.server";
import { formatSqliteTimestamp } from "./topoSync.server";

/**
 * Review of pending objects. An account's pending objects that reference each
 * other by ref form a chain (a new crag with its new sectors, routes, and
 * topos); a chain is approved or rejected together, parents first. Each object
 * is applied and recorded on its own, so a failure leaves the objects before it
 * published and the rest pending. See docs/submissions-review-plan.md.
 */

export type ReviewResult = { ok: true } | { ok: false; error: string };

/** A chain of one account's linked pending objects, parents first. */
export type ReviewChain = {
  /** The chain's smallest object id; any of its object ids identifies it. */
  key: number;
  uid: string;
  source: string;
  author: AuditActor;
  authorEmail: string | null;
  objects: SubmissionObject[];
};

class SubmissionApplyError extends Error {}

/** Groups objects into chains: objects of one account linked by refs, in either direction. */
export function groupIntoChains(objects: SubmissionObject[]): SubmissionObject[][] {
  const parent = new Map<number, number>(objects.map((object) => [object.id, object.id]));
  const find = (id: number): number => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };

  const byRef = new Map(objects.filter((o) => o.ref !== null).map((o) => [`${o.uid}:${o.ref}`, o]));
  for (const object of objects) {
    mapReferences(object.entity, object.fields, (value) => {
      const referenced = typeof value === "string" ? byRef.get(`${object.uid}:${value}`) : undefined;
      if (referenced) parent.set(find(object.id), find(referenced.id));
      return value;
    });
  }

  const chains = new Map<number, SubmissionObject[]>();
  for (const object of objects) {
    const root = find(object.id);
    chains.set(root, [...(chains.get(root) ?? []), object]);
  }
  return [...chains.values()].map(sortParentsFirst);
}

async function loadPendingObjects(db: Kysely<DB>, uid?: string) {
  const rows = await db.selectFrom("submission")
    .leftJoin("user", "submission.uid", "user.uid")
    .selectAll("submission")
    .select(["user.display_name as authorName", "user.email as authorEmail"])
    .where("submission.state", "=", "pending")
    .$if(uid !== undefined, (qb) => qb.where("submission.uid", "=", uid!))
    .orderBy("submission.id")
    .execute();
  const people = new Map(rows.map((row) => [row.uid, { name: row.authorName, email: row.authorEmail }]));
  return { objects: rows.map(toSubmissionObject), people };
}

function toChain(objects: SubmissionObject[], people: Map<string, { name: string | null; email: string | null }>): ReviewChain {
  const { uid, source } = objects[0];
  return {
    key: Math.min(...objects.map((object) => object.id)),
    uid,
    source,
    author: { uid, displayName: people.get(uid)?.name ?? null },
    authorEmail: people.get(uid)?.email ?? null,
    objects,
  };
}

/** Every pending chain, most recently received first. */
export async function loadPendingChains(db: Kysely<DB>): Promise<ReviewChain[]> {
  const { objects, people } = await loadPendingObjects(db);
  const latest = (chain: ReviewChain) => chain.objects.reduce((max, o) => (o.receivedAt > max ? o.receivedAt : max), "");
  return groupIntoChains(objects)
    .map((chain) => toChain(chain, people))
    .sort((a, b) => latest(b).localeCompare(latest(a)) || b.key - a.key);
}

/** The pending chain containing an object, or null once it's been decided. */
export async function loadChain(db: Kysely<DB>, objectId: number): Promise<ReviewChain | null> {
  const row = await db.selectFrom("submission").select(["uid", "state"]).where("id", "=", objectId).executeTakeFirst();
  if (!row || row.state !== "pending") return null;
  const { objects, people } = await loadPendingObjects(db, row.uid);
  const chain = groupIntoChains(objects).find((candidate) => candidate.some((object) => object.id === objectId));
  return chain ? toChain(chain, people) : null;
}

/** Record ids for the refs a chain uses, from the account's published objects. */
async function publishedRefIds(db: Kysely<DB>, chain: ReviewChain) {
  const refs = new Set<string>();
  for (const object of chain.objects) {
    mapReferences(object.entity, object.fields, (value) => {
      if (typeof value === "string") refs.add(value);
      return value;
    });
  }
  const ids = new Map<string, number>();
  for (const refChunk of chunk([...refs], MAX_IDS_PER_QUERY)) {
    const rows = await db.selectFrom("submission")
      .select(["ref", "target_id"])
      .where("uid", "=", chain.uid)
      .where("ref", "in", refChunk)
      .where("target_id", "is not", null)
      .execute();
    rows.forEach((row) => ids.set(row.ref!, row.target_id!));
  }
  return ids;
}

/** An object's fields with every ref replaced by its record id. */
function resolvedFields(object: SubmissionObject, refIds: Map<string, number>) {
  return mapReferences(object.entity, object.fields, (value) => {
    if (typeof value === "number") return value;
    const id = refIds.get(value);
    if (id === undefined) throw new SubmissionApplyError(`The ${object.entity} "${object.ref ?? object.targetId}" depends on "${value}", which isn't published.`);
    return id;
  });
}

function toColumns(entity: SubmissionEntity, fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [SUBMISSION_FIELDS[entity][name].column, value]));
}

async function insertRecord(db: Kysely<DB>, entity: Exclude<SubmissionEntity, "topo">, values: Record<string, unknown>) {
  const rowValues = entity === "crag" ? { ...values, slug: await slugifyUnique(db, String(values.name)) } : values;
  const row = await db.insertInto(entity)
    .values(rowValues as Insertable<DB[typeof entity]>)
    .returning("id")
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

async function saveTopo(context: AppLoadContext, uid: string, targetId: number | null, fields: Record<string, unknown>, existingName: unknown) {
  const payload: SaveRawTopoPayload = {
    ...(targetId !== null ? { id: targetId } : {}),
    ...(typeof fields.uuid === "string" ? { uuid: fields.uuid } : {}),
    // saveRawTopo requires a name; an edit that doesn't rename keeps the current one.
    name: (fields.name as string | undefined) ?? (existingName as string | undefined) ?? "",
    ...("description" in fields ? { description: fields.description as string | null } : {}),
    ...("cragId" in fields ? { cragId: fields.cragId as number | null } : {}),
    ...("sectorId" in fields ? { sectorId: fields.sectorId as number | null } : {}),
    ...("latitude" in fields ? { latitude: fields.latitude as number | null } : {}),
    ...("longitude" in fields ? { longitude: fields.longitude as number | null } : {}),
    ...("status" in fields ? { status: fields.status as TopoStatus } : {}),
    ...("background" in fields ? { backgroundUrl: fields.background as string } : {}),
    ...("raster" in fields ? { rasterUrl: fields.raster as string } : {}),
    ...("annotations" in fields ? { annotations: fields.annotations as SaveRawTopoPayload["annotations"] } : {}),
    ...("routes" in fields ? { routes: (fields.routes as SubmissionTopoRoute[]).map((link) => ({ ...link, routeId: link.routeId as number })) } : {}),
  };
  return (await saveRawTopo(context, { uid, payload })).id;
}

async function applyObject(
  context: AppLoadContext,
  db: Kysely<DB>,
  object: SubmissionObject,
  refIds: Map<string, number>,
): Promise<{ id: number; changes: AuditChanges | null }> {
  const fields = resolvedFields(object, refIds);
  const before = object.targetId !== null
    ? (await loadAuditRows(db, object.entity, [object.targetId])).get(object.targetId)
    : undefined;
  if (object.targetId !== null && !before) {
    throw new SubmissionApplyError(`${object.entity} ${object.targetId} no longer exists.`);
  }

  let id: number;
  if (object.entity === "topo") {
    id = await saveTopo(context, object.uid, object.targetId, fields, before?.name);
  } else if (object.targetId === null) {
    id = await insertRecord(db, object.entity, toColumns(object.entity, fields));
  } else {
    id = object.targetId;
    await db.updateTable(object.entity)
      .set(toColumns(object.entity, fields) as Updateable<DB[typeof object.entity]>)
      .where("id", "=", id)
      .execute();
  }

  const after = (await loadAuditRows(db, object.entity, [id])).get(id);
  return { id, changes: describeChange(object.entity, before, after)?.changes ?? null };
}

/**
 * Publishes a chain, parents first. Each object is saved as published, with its
 * record id, as soon as it's applied, so approving again after a failure or a
 * crash continues with the objects still pending.
 */
export async function approveChain(
  context: AppLoadContext,
  { item, reviewer }: { item: number; reviewer: AuditActor },
): Promise<ReviewResult> {
  const db = getDB(context);
  const chain = await loadChain(db, item);
  if (!chain) {
    return { ok: false, error: "This has already been decided or doesn't exist." };
  }

  const refIds = await publishedRefIds(db, chain);
  for (const object of chain.objects) {
    try {
      const applied = await applyObject(context, db, object, refIds);
      const now = formatSqliteTimestamp();
      await db.updateTable("submission")
        .set({ target_id: applied.id, state: "published", error: null, decided_at: now, updated_at: now })
        .where("id", "=", object.id)
        .execute();
      if (object.ref !== null) refIds.set(object.ref, applied.id);

      await writeAudit(db, [{
        author: chain.author,
        reviewer,
        decision: "approved",
        source: object.source,
        entity: object.entity,
        entityId: applied.id,
        action: object.targetId === null ? "create" : "update",
        // Written even when nothing changed, so every approval is on record.
        changes: applied.changes ?? {},
        submissionId: String(object.id),
        ref: object.ref,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Approving submission object ${object.id} failed:`, error);
      await db.updateTable("submission")
        .set({ error: message, updated_at: formatSqliteTimestamp() })
        .where("id", "=", object.id)
        .execute();
      return { ok: false, error: message };
    }
  }
  return { ok: true };
}

/** Rejects every object in a chain, recording each proposal against the current values. */
export async function rejectChain(
  context: AppLoadContext,
  { item, reviewer }: { item: number; reviewer: AuditActor },
): Promise<ReviewResult> {
  const db = getDB(context);
  const chain = await loadChain(db, item);
  if (!chain) {
    return { ok: false, error: "This has already been decided or doesn't exist." };
  }

  const entries: AuditEntry[] = [];
  for (const object of chain.objects) {
    const current = object.targetId !== null
      ? (await loadAuditRows(db, object.entity, [object.targetId])).get(object.targetId)
      : undefined;
    const changes: AuditChanges = {};
    for (const [name, value] of Object.entries(object.fields)) {
      const column = SUBMISSION_FIELDS[object.entity][name].column;
      changes[column] = [current?.[column] ?? null, value];
    }
    entries.push({
      author: chain.author,
      reviewer,
      decision: "rejected",
      source: object.source,
      entity: object.entity,
      entityId: object.targetId,
      action: object.targetId === null ? "create" : "update",
      changes,
      submissionId: String(object.id),
      ref: object.ref,
    });
  }

  await writeAudit(db, entries);
  const now = formatSqliteTimestamp();
  for (const idChunk of chunk(chain.objects.map((object) => object.id), MAX_IDS_PER_QUERY)) {
    await db.updateTable("submission")
      .set({ state: "rejected", error: null, decided_at: now, updated_at: now })
      .where("id", "in", idChunk)
      .execute();
  }
  return { ok: true };
}
