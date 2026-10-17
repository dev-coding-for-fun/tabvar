import type { Kysely } from "kysely";
import type { AppLoadContext } from "react-router";
import type { AuditEntity } from "./audit.server";
import { IMAGE_TYPES } from "./constants";
import { getDB } from "./db";
import type { DB } from "./db.d";
import { deleteFromR2, uploadFileToR2 } from "./s3.server";
import { toStoredJson } from "./storedJson";

/**
 * Submission intake. A submission is a queued list of proposed creates and edits
 * to crags, sectors, routes, and topos. Its row exists only until an admin
 * approves or rejects it; decisions are kept in audit_log.
 * See docs/submissions-review-plan.md.
 */

const MAX_CHANGES = 500;
const MAX_TOPO_ROUTES = 200;
const MAX_REPORTED_ERRORS = 10;
// D1 allows at most 100 bound parameters per query.
const MAX_IDS_PER_QUERY = 90;
const FILE_PLACEHOLDER_PREFIX = "file:";

export type SubmissionEntity = AuditEntity;
export type SubmissionOp = "create" | "update";
/** An existing numeric id, or the `ref` of an earlier create in the same submission. */
export type SubmissionRef = number | string;

export type SubmissionTopoRoute = {
  routeId: SubmissionRef;
  label?: string | null;
  sortOrder?: number;
};

export type SubmissionChange = {
  ref?: string;
  entity: SubmissionEntity;
  op: SubmissionOp;
  /** The target of an update. Approval also sets it on a create once the row exists. */
  id?: number;
  /** Set once approval has applied and audited this change. */
  applied?: boolean;
  baseUpdatedAt?: string;
  fields: Record<string, unknown>;
};

export type SubmissionPayload = {
  changes: SubmissionChange[];
};

export type SubmissionStatus = {
  id: string;
  status: "pending" | "approved" | "rejected";
  error?: string | null;
  /** New record ids by `ref`, once approved. */
  ids?: Record<string, number>;
};

type FieldKind =
  | "requiredText"
  | "text"
  | "number"
  | "integer"
  | "parent"
  | "optionalParent"
  | "file"
  | "annotations"
  | "routes";

type FieldSpec = {
  column: string;
  kind: FieldKind;
  parent?: SubmissionEntity;
};

const text = (column: string): FieldSpec => ({ column, kind: "text" });
const number = (column: string): FieldSpec => ({ column, kind: "number" });
const integer = (column: string): FieldSpec => ({ column, kind: "integer" });

/** Editable fields per entity, keyed by their sync API (camelCase) names. */
export const SUBMISSION_FIELDS: Record<SubmissionEntity, Record<string, FieldSpec>> = {
  crag: {
    name: { column: "name", kind: "requiredText" },
    notes: text("notes"),
    latitude: number("latitude"),
    longitude: number("longitude"),
  },
  sector: {
    name: { column: "name", kind: "requiredText" },
    cragId: { column: "crag_id", kind: "parent", parent: "crag" },
    notes: text("notes"),
    latitude: number("latitude"),
    longitude: number("longitude"),
    sortOrder: integer("sort_order"),
  },
  route: {
    name: { column: "name", kind: "requiredText" },
    altNames: text("alt_names"),
    sectorId: { column: "sector_id", kind: "parent", parent: "sector" },
    gradeYds: text("grade_yds"),
    climbStyle: text("climb_style"),
    boltCount: integer("bolt_count"),
    pitchCount: integer("pitch_count"),
    routeLength: number("route_length"),
    firstAscentBy: text("first_ascent_by"),
    firstAscentDate: text("first_ascent_date"),
    routeBuiltDate: text("route_built_date"),
    year: integer("year"),
    status: text("status"),
    notes: text("notes"),
    sortOrder: integer("sort_order"),
    latitude: number("latitude"),
    longitude: number("longitude"),
  },
  topo: {
    uuid: { column: "uuid", kind: "requiredText" },
    name: { column: "name", kind: "requiredText" },
    description: text("description"),
    cragId: { column: "crag_id", kind: "optionalParent", parent: "crag" },
    sectorId: { column: "sector_id", kind: "optionalParent", parent: "sector" },
    latitude: number("latitude"),
    longitude: number("longitude"),
    status: text("status"),
    annotations: { column: "annotations_json", kind: "annotations" },
    background: { column: "background_image_url", kind: "file" },
    raster: { column: "raster_image_url", kind: "file" },
    routes: { column: "routes", kind: "routes" },
  },
};

const REQUIRED_ON_CREATE: Record<SubmissionEntity, string[]> = {
  crag: ["name"],
  sector: ["name", "cragId"],
  route: ["name", "sectorId"],
  topo: ["name", "background", "raster"],
};

const ENTITIES = Object.keys(SUBMISSION_FIELDS) as SubmissionEntity[];

export class SubmissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Reads a submission from a JSON body, or from a multipart `submission` field plus file parts. */
export async function parseSubmissionRequest(request: Request): Promise<{ payload: unknown; files: Map<string, File> }> {
  const files = new Map<string, File>();
  const contentType = request.headers.get("content-type") ?? "";
  let raw: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const submission = formData.get("submission");
    if (typeof submission !== "string") {
      throw new SubmissionValidationError("The multipart `submission` field must contain the submission JSON.");
    }
    raw = submission;
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        files.set(key, value);
      }
    }
  } else {
    raw = await request.text();
  }

  try {
    return { payload: JSON.parse(raw), files };
  } catch {
    throw new SubmissionValidationError("The submission must be valid JSON.");
  }
}

type ExistenceCheck = { entity: SubmissionEntity; id: number; path: string };

class Problems {
  readonly messages: string[] = [];

  add(message: string) {
    this.messages.push(message);
  }

  throwIfAny() {
    if (this.messages.length === 0) return;
    const shown = this.messages.slice(0, MAX_REPORTED_ERRORS);
    const more = this.messages.length - shown.length;
    throw new SubmissionValidationError(shown.join("; ") + (more > 0 ? `; and ${more} more` : ""));
  }
}

function checkParent(
  value: unknown,
  path: string,
  parent: SubmissionEntity,
  refs: Map<string, SubmissionEntity>,
  checks: ExistenceCheck[],
  problems: Problems,
) {
  if (isPositiveInteger(value)) {
    checks.push({ entity: parent, id: value, path });
  } else if (typeof value === "string") {
    if (refs.get(value) !== parent) {
      problems.add(`${path} refers to "${value}", which is not the ref of an earlier ${parent} create`);
    }
  } else {
    problems.add(`${path} must be an existing ${parent} id or the ref of an earlier ${parent} create`);
  }
}

function checkField(
  entity: SubmissionEntity,
  name: string,
  value: unknown,
  path: string,
  context: { refs: Map<string, SubmissionEntity>; checks: ExistenceCheck[]; files: Map<string, File>; problems: Problems },
) {
  const spec = SUBMISSION_FIELDS[entity][name];
  const { refs, checks, files, problems } = context;

  if (!spec) {
    problems.add(`${path} is not an editable ${entity} field`);
    return;
  }

  switch (spec.kind) {
    case "requiredText":
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.add(`${path} must be a non-empty string`);
      }
      return;
    case "text":
      if (value !== null && typeof value !== "string") {
        problems.add(`${path} must be a string or null`);
      }
      return;
    case "number":
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        problems.add(`${path} must be a number or null`);
      }
      return;
    case "integer":
      if (value !== null && !Number.isInteger(value)) {
        problems.add(`${path} must be an integer or null`);
      }
      return;
    case "optionalParent":
      if (value === null) return;
      checkParent(value, path, spec.parent!, refs, checks, problems);
      return;
    case "parent":
      checkParent(value, path, spec.parent!, refs, checks, problems);
      return;
    case "file": {
      const fileName = typeof value === "string" && value.startsWith(FILE_PLACEHOLDER_PREFIX)
        ? value.slice(FILE_PLACEHOLDER_PREFIX.length)
        : null;
      const file = fileName ? files.get(fileName) : undefined;
      if (!fileName) {
        problems.add(`${path} must be a "${FILE_PLACEHOLDER_PREFIX}<part name>" reference to an uploaded file`);
      } else if (!file) {
        problems.add(`${path} refers to missing file part "${fileName}"`);
      } else if (!IMAGE_TYPES.includes(file.type)) {
        problems.add(`${path} has unsupported file type "${file.type || "unknown"}"`);
      }
      return;
    }
    case "annotations":
      if (!Array.isArray(value) && !(isRecord(value) && Array.isArray(value.items))) {
        problems.add(`${path} must be an annotation document`);
      }
      return;
    case "routes":
      if (!Array.isArray(value)) {
        problems.add(`${path} must be an array`);
        return;
      }
      if (value.length > MAX_TOPO_ROUTES) {
        problems.add(`${path} can link at most ${MAX_TOPO_ROUTES} routes`);
        return;
      }
      value.forEach((link, index) => {
        const linkPath = `${path}[${index}]`;
        if (!isRecord(link)) {
          problems.add(`${linkPath} must be an object`);
          return;
        }
        checkParent(link.routeId, `${linkPath}.routeId`, "route", refs, checks, problems);
        if (link.label !== undefined && link.label !== null && typeof link.label !== "string") {
          problems.add(`${linkPath}.label must be a string or null`);
        }
        if (link.sortOrder !== undefined && !Number.isInteger(link.sortOrder)) {
          problems.add(`${linkPath}.sortOrder must be an integer`);
        }
        for (const key of Object.keys(link)) {
          if (!["routeId", "label", "sortOrder"].includes(key)) {
            problems.add(`${linkPath}.${key} is not a topo route link field`);
          }
        }
      });
      return;
  }
}

async function findMissingIds(db: Kysely<DB>, checks: ExistenceCheck[]): Promise<ExistenceCheck[]> {
  const missing: ExistenceCheck[] = [];
  for (const entity of ENTITIES) {
    const entityChecks = checks.filter((check) => check.entity === entity);
    const ids = [...new Set(entityChecks.map((check) => check.id))];
    const found = new Set<number>();
    for (const idChunk of chunk(ids, MAX_IDS_PER_QUERY)) {
      const rows = await db.selectFrom(entity).select("id").where("id", "in", idChunk).execute();
      rows.forEach((row) => found.add(Number(row.id)));
    }
    missing.push(...entityChecks.filter((check) => !found.has(check.id)));
  }
  return missing;
}

/**
 * Checks a submission's shape, fields, refs, files, and targets, and returns it
 * as a typed payload. Throws SubmissionValidationError describing every problem.
 */
export async function validateSubmission(
  db: Kysely<DB>,
  payload: unknown,
  files: Map<string, File>,
): Promise<SubmissionPayload> {
  const problems = new Problems();

  if (!isRecord(payload) || !Array.isArray(payload.changes)) {
    throw new SubmissionValidationError("The submission must be an object with a `changes` array.");
  }
  if (payload.changes.length === 0) {
    throw new SubmissionValidationError("The submission must include at least one change.");
  }
  if (payload.changes.length > MAX_CHANGES) {
    throw new SubmissionValidationError(`A submission can include at most ${MAX_CHANGES} changes.`);
  }

  const refs = new Map<string, SubmissionEntity>();
  const checks: ExistenceCheck[] = [];
  const topoUuids = new Map<string, string>();
  const changes: SubmissionChange[] = [];

  payload.changes.forEach((rawChange, index) => {
    const path = `changes[${index}]`;
    if (!isRecord(rawChange)) {
      problems.add(`${path} must be an object`);
      return;
    }

    const { ref, entity, op, id, baseUpdatedAt, fields } = rawChange;
    for (const key of Object.keys(rawChange)) {
      if (!["ref", "entity", "op", "id", "baseUpdatedAt", "fields"].includes(key)) {
        problems.add(`${path}.${key} is not a change field`);
      }
    }
    if (typeof entity !== "string" || !ENTITIES.includes(entity as SubmissionEntity)) {
      problems.add(`${path}.entity must be one of ${ENTITIES.join(", ")}`);
      return;
    }
    if (op !== "create" && op !== "update") {
      problems.add(`${path}.op must be create or update`);
      return;
    }
    if (!isRecord(fields)) {
      problems.add(`${path}.fields must be an object`);
      return;
    }

    const changeEntity = entity as SubmissionEntity;
    const fieldContext = { refs, checks, files, problems };
    for (const [name, value] of Object.entries(fields)) {
      checkField(changeEntity, name, value, `${path}.fields.${name}`, fieldContext);
    }

    if (op === "create") {
      if (id !== undefined) problems.add(`${path}.id is only allowed on an update`);
      if (baseUpdatedAt !== undefined) problems.add(`${path}.baseUpdatedAt is only allowed on an update`);
      for (const required of REQUIRED_ON_CREATE[changeEntity]) {
        if (fields[required] === undefined || fields[required] === null) {
          problems.add(`${path}.fields.${required} is required to create a ${changeEntity}`);
        }
      }
      if (ref !== undefined) {
        if (typeof ref !== "string" || ref.length === 0) {
          problems.add(`${path}.ref must be a non-empty string`);
        } else if (refs.has(ref)) {
          problems.add(`${path}.ref "${ref}" is already used by an earlier change`);
        } else {
          refs.set(ref, changeEntity);
        }
      }
      if (changeEntity === "topo" && typeof fields.uuid === "string") {
        if (topoUuids.has(fields.uuid)) {
          problems.add(`${path}.fields.uuid repeats ${topoUuids.get(fields.uuid)}`);
        }
        topoUuids.set(fields.uuid, `${path}.fields.uuid`);
      }
    } else {
      if (ref !== undefined) problems.add(`${path}.ref is only allowed on a create`);
      if (!isPositiveInteger(id)) {
        problems.add(`${path}.id must be the id of an existing ${changeEntity}`);
      } else {
        checks.push({ entity: changeEntity, id, path: `${path}.id` });
      }
      if (baseUpdatedAt !== undefined && typeof baseUpdatedAt !== "string") {
        problems.add(`${path}.baseUpdatedAt must be a timestamp string`);
      }
      if (Object.keys(fields).length === 0) {
        problems.add(`${path}.fields must include at least one field to change`);
      }
      if (fields.uuid !== undefined) {
        problems.add(`${path}.fields.uuid can't be changed`);
      }
    }

    changes.push({
      ...(typeof ref === "string" ? { ref } : {}),
      entity: changeEntity,
      op,
      ...(isPositiveInteger(id) ? { id } : {}),
      ...(typeof baseUpdatedAt === "string" ? { baseUpdatedAt } : {}),
      // Copied so storing files can replace placeholders without changing the caller's object.
      fields: { ...fields },
    });
  });

  problems.throwIfAny();

  for (const missing of await findMissingIds(db, checks)) {
    problems.add(`${missing.path} refers to ${missing.entity} ${missing.id}, which doesn't exist`);
  }
  for (const uuidChunk of chunk([...topoUuids.keys()], MAX_IDS_PER_QUERY)) {
    const existing = await db.selectFrom("topo").select("uuid").where("uuid", "in", uuidChunk).execute();
    for (const { uuid } of existing) {
      problems.add(`${topoUuids.get(uuid)} "${uuid}" belongs to an existing topo; send an update instead`);
    }
  }
  problems.throwIfAny();

  return { changes };
}

function fileFieldNames(entity: SubmissionEntity) {
  return Object.entries(SUBMISSION_FIELDS[entity])
    .filter(([, spec]) => spec.kind === "file")
    .map(([name]) => name);
}

/**
 * Validates and queues a submission. Referenced files are stored in R2 under
 * `submissions/<id>/`, and their placeholders are replaced with the stored URLs.
 */
export async function createSubmission(
  context: AppLoadContext,
  { uid, source, payload, files }: { uid: string; source: string; payload: unknown; files: Map<string, File> },
): Promise<SubmissionStatus> {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;
  const submission = await validateSubmission(db, payload, files);
  const id = crypto.randomUUID();
  const uploaded = new Map<string, { url: string; key: string }>();

  try {
    for (const change of submission.changes) {
      for (const field of fileFieldNames(change.entity)) {
        const placeholder = change.fields[field];
        if (typeof placeholder !== "string") continue;

        const fileName = placeholder.slice(FILE_PLACEHOLDER_PREFIX.length);
        let stored = uploaded.get(fileName);
        if (!stored) {
          const result = await uploadFileToR2(
            context,
            files.get(fileName)!,
            env.TOPOS_BUCKET_NAME,
            env.TOPOS_BUCKET_DOMAIN,
            { keyPrefix: `submissions/${id}`, useContentHash: true },
          );
          stored = { url: result.url, key: result.name };
          uploaded.set(fileName, stored);
        }
        change.fields[field] = stored.url;
      }
    }

    await db.insertInto("submission")
      .values({ id, uid, source, payload: toStoredJson(submission) })
      .execute();
  } catch (error) {
    const cleanup = await Promise.allSettled(
      [...uploaded.values()].map((stored) => deleteFromR2(context, env.TOPOS_BUCKET_NAME, stored.key)),
    );
    cleanup
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .forEach((result) => console.error("Failed to remove a file from a failed submission:", result.reason));
    throw error;
  }

  return { id, status: "pending" };
}

/**
 * Reports on one of the caller's submissions: pending while queued, then the
 * decision and created ids recorded in audit_log. Null if the caller has none by this id.
 */
export async function getSubmissionStatus(
  context: AppLoadContext,
  { uid, id }: { uid: string; id: string },
): Promise<SubmissionStatus | null> {
  const db = getDB(context);

  const queued = await db.selectFrom("submission")
    .select(["id", "error"])
    .where("id", "=", id)
    .where("uid", "=", uid)
    .executeTakeFirst();
  if (queued) {
    return { id, status: "pending", error: queued.error };
  }

  const decided = await db.selectFrom("audit_log")
    .select(["decision", "ref", "entity_id"])
    .where("submission_id", "=", id)
    .where("author_uid", "=", uid)
    .execute();
  if (decided.length === 0) {
    return null;
  }

  const ids: Record<string, number> = {};
  for (const row of decided) {
    if (row.decision === "approved" && row.ref && row.entity_id !== null) {
      ids[row.ref] = row.entity_id;
    }
  }

  return {
    id,
    status: decided.some((row) => row.decision === "rejected") ? "rejected" : "approved",
    ids,
  };
}
