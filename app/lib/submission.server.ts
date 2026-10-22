import type { Kysely, Selectable } from "kysely";
import type { AppLoadContext } from "react-router";
import { chunk, loadAuditRows, MAX_IDS_PER_QUERY, sameValue, type AuditEntity } from "./audit.server";
import { IMAGE_TYPES } from "./constants";
import { getDB } from "./db";
import type { DB, Submission } from "./db.d";
import { ImageSizeError, measureImage, type ImageSize } from "./imageSize.server";
import type { TopoAnnotationDocument } from "./models";
import { calculateFileHash, uploadFileToR2 } from "./s3.server";
import { toStoredJson } from "./storedJson";
import { normalizeAnnotationDocument, TOPO_STATUSES, type TopoStatus } from "./topo.server";
import { BACKGROUND_KEY_PREFIX, hashFromUrl, RASTER_KEY_PREFIX, removeUnusedTopoFiles } from "./topoFiles.server";
import { formatSqliteTimestamp } from "./topoSync.server";

/**
 * Submissions are per object. Each row of `submission` is one account's latest
 * proposal for one crag, sector, route, or topo, and stays afterwards as the link
 * between the app's own id for the object (`ref`) and the TABVAR record
 * (`target_id`). A row is a new object while `target_id` is null, and an edit
 * once it's set. See docs/submissions-review-plan.md.
 */

const MAX_OBJECTS = 500;
const MAX_TOPO_ROUTES = 200;
const MAX_REPORTED_ERRORS = 10;
const FILE_PLACEHOLDER_PREFIX = "file:";

export type SubmissionEntity = AuditEntity;
export type SubmissionState = "pending" | "published" | "rejected";
/** An existing record's numeric id, or the app's `ref` for one of its own objects. */
export type SubmissionRef = number | string;

export type SubmissionTopoRoute = {
  routeId: SubmissionRef;
  label?: string | null;
  sortOrder?: number;
};

/** One account's proposal for one object. */
export type SubmissionObject = {
  id: number;
  uid: string;
  source: string;
  entity: SubmissionEntity;
  ref: string | null;
  targetId: number | null;
  fields: Record<string, unknown>;
  baseUpdatedAt: string | null;
  state: SubmissionState;
  error: string | null;
  receivedAt: string;
  decidedAt: string | null;
  updatedAt: string;
};

/** Parents come before children: objects only reference entities earlier in this list. */
export const ENTITY_ORDER: SubmissionEntity[] = ["crag", "sector", "route", "topo"];

export function toSubmissionObject(row: Selectable<Submission>): SubmissionObject {
  return {
    id: row.id,
    uid: row.uid,
    source: row.source,
    entity: row.entity as SubmissionEntity,
    ref: row.ref,
    targetId: row.target_id,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    baseUpdatedAt: row.base_updated_at,
    state: row.state as SubmissionState,
    error: row.error,
    receivedAt: row.received_at,
    decidedAt: row.decided_at,
    updatedAt: row.updated_at,
  };
}

export function sortParentsFirst<T extends { entity: SubmissionEntity }>(objects: T[]): T[] {
  return [...objects].sort((a, b) => ENTITY_ORDER.indexOf(a.entity) - ENTITY_ORDER.indexOf(b.entity));
}

type FieldKind =
  | "requiredText"
  | "topoStatus"
  | "text"
  | "number"
  | "integer"
  | "parent"
  | "optionalParent"
  | "file"
  | "measured"
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
    status: { column: "status", kind: "topoStatus" },
    annotations: { column: "annotations_json", kind: "annotations" },
    background: { column: "background_image_url", kind: "file" },
    raster: { column: "raster_image_url", kind: "file" },
    routes: { column: "routes", kind: "routes" },
    // Set by intake from the background image, which annotations are positioned on.
    imageWidth: { column: "image_width", kind: "measured" },
    imageHeight: { column: "image_height", kind: "measured" },
  },
};

/**
 * How a topo's file fields are stored. The raster is rendered from the background
 * and annotations, so it's `derived`: a new raster alone isn't a change.
 */
const TOPO_FILES: Record<string, { keyPrefix: string; hashColumn: string; derived: boolean }> = {
  background: { keyPrefix: BACKGROUND_KEY_PREFIX, hashColumn: "background_image_hash", derived: false },
  raster: { keyPrefix: RASTER_KEY_PREFIX, hashColumn: "raster_image_hash", derived: true },
};

const REQUIRED_ON_CREATE: Record<SubmissionEntity, string[]> = {
  crag: ["name"],
  sector: ["name", "cragId"],
  route: ["name", "sectorId"],
  topo: ["name", "background", "raster"],
};

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

/** The items of an annotation document, which may also be sent as a bare array. */
export function annotationItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) && Array.isArray(value.items) ? value.items : [];
}

/**
 * Rewrites every reference in an object's fields: parent fields, a topo's route
 * links, and annotation items' `routeId`. `replace` gets each value with the
 * entity it must point to and a path for messages; other fields are copied as is.
 */
export function mapReferences(
  entity: SubmissionEntity,
  fields: Record<string, unknown>,
  replace: (value: SubmissionRef, target: SubmissionEntity, path: string) => SubmissionRef,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const spec = SUBMISSION_FIELDS[entity][name];
    const path = `fields.${name}`;
    if ((spec?.kind === "parent" || spec?.kind === "optionalParent") && (typeof value === "string" || typeof value === "number")) {
      mapped[name] = replace(value, spec.parent!, path);
    } else if (spec?.kind === "routes" && Array.isArray(value)) {
      mapped[name] = (value as SubmissionTopoRoute[]).map((link, index) => ({
        ...link,
        routeId: replace(link.routeId, "route", `${path}[${index}].routeId`),
      }));
    } else if (spec?.kind === "annotations" && (Array.isArray(value) || isRecord(value))) {
      const items = annotationItems(value).map((item, index) =>
        isRecord(item) && (typeof item.routeId === "string" || typeof item.routeId === "number")
          ? { ...item, routeId: replace(item.routeId, "route", `${path}.items[${index}].routeId`) }
          : item);
      mapped[name] = Array.isArray(value) ? items : { ...value, items };
    } else {
      mapped[name] = value;
    }
  }
  return mapped;
}

/** A record's current value for a field, in the same shape as a proposed value. */
export function recordFieldValue(entity: SubmissionEntity, field: string, row: Record<string, unknown>): unknown {
  const spec = SUBMISSION_FIELDS[entity][field];
  const value = row[spec.column];
  if (spec.kind === "routes") {
    return ((value as { route_id: number; label: string | null }[] | undefined) ?? [])
      .map((link) => ({ routeId: link.route_id, label: link.label }));
  }
  if (spec.kind === "annotations" && typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

/** A JSON value with object keys sorted, so key order doesn't affect comparison. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key])]));
}

/**
 * Whether a proposed value equals a record's current one. Route links compare by
 * route and label; annotations as the stored document, whatever their key order.
 */
export function sameFieldValue(entity: SubmissionEntity, field: string, current: unknown, proposed: unknown) {
  const { kind } = SUBMISSION_FIELDS[entity][field];
  const comparable = (value: unknown) => {
    if (kind === "routes" && Array.isArray(value)) {
      return (value as SubmissionTopoRoute[]).map((link) => [link.routeId, link.label ?? null]);
    }
    if (kind === "annotations" && value !== null && value !== undefined) {
      return sortedKeys(normalizeAnnotationDocument(value as TopoAnnotationDocument | unknown[]));
    }
    return value;
  };
  return sameValue(comparable(current), comparable(proposed));
}

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

/** Checks a field's value against its kind. References are only checked for type here. */
function checkFieldValue(
  entity: SubmissionEntity,
  name: string,
  value: unknown,
  path: string,
  files: Map<string, File>,
  problems: Problems,
) {
  const spec = SUBMISSION_FIELDS[entity][name];
  if (!spec) {
    problems.add(`${path} is not an editable ${entity} field`);
    return;
  }
  const reference = (target: unknown, at: string, of: SubmissionEntity) => {
    if (!isPositiveInteger(target) && (typeof target !== "string" || target.length === 0)) {
      problems.add(`${at} must be an existing ${of} id or your ref for one`);
    }
  };

  switch (spec.kind) {
    case "requiredText":
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.add(`${path} must be a non-empty string`);
      }
      return;
    case "topoStatus":
      if (!TOPO_STATUSES.includes(value as TopoStatus)) {
        problems.add(`${path} must be one of ${TOPO_STATUSES.join(", ")}`);
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
      if (value !== null) reference(value, path, spec.parent!);
      return;
    case "parent":
      reference(value, path, spec.parent!);
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
    case "measured":
      problems.add(`${path} is measured from the background image, so it can't be sent`);
      return;
    case "annotations":
      if (!Array.isArray(value) && !(isRecord(value) && Array.isArray(value.items))) {
        problems.add(`${path} must be an annotation document`);
        return;
      }
      annotationItems(value).forEach((item, index) => {
        if (isRecord(item) && item.routeId !== undefined && item.routeId !== null) {
          reference(item.routeId, `${path}.items[${index}].routeId`, "route");
        }
      });
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
        reference(link.routeId, `${linkPath}.routeId`, "route");
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

/** One object from a request: a proposal for the app's own object (`ref`) or a record (`id`), or a withdrawal. */
type IncomingObject = {
  path: string;
  entity: SubmissionEntity;
  ref: string | null;
  id: number | null;
  withdraw: boolean;
  baseUpdatedAt: string | null;
  fields: Record<string, unknown>;
};

function parseObjects(payload: unknown, files: Map<string, File>): IncomingObject[] {
  if (!isRecord(payload) || !Array.isArray(payload.objects)) {
    throw new SubmissionValidationError("The submission must be an object with an `objects` array.");
  }
  if (payload.objects.length === 0) {
    throw new SubmissionValidationError("The submission must include at least one object.");
  }
  if (payload.objects.length > MAX_OBJECTS) {
    throw new SubmissionValidationError(`A submission can include at most ${MAX_OBJECTS} objects.`);
  }

  const problems = new Problems();
  const seen = new Set<string>();
  const objects: IncomingObject[] = [];

  payload.objects.forEach((raw, index) => {
    const path = `objects[${index}]`;
    if (!isRecord(raw)) {
      problems.add(`${path} must be an object`);
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!["entity", "ref", "id", "withdraw", "baseUpdatedAt", "fields"].includes(key)) {
        problems.add(`${path}.${key} is not an object field`);
      }
    }
    const { entity, ref, id, withdraw, baseUpdatedAt, fields } = raw;
    if (typeof entity !== "string" || !ENTITY_ORDER.includes(entity as SubmissionEntity)) {
      problems.add(`${path}.entity must be one of ${ENTITY_ORDER.join(", ")}`);
      return;
    }
    if ((ref === undefined) === (id === undefined)) {
      problems.add(`${path} needs either a ref (your id for the object) or an id (an existing record), not both`);
      return;
    }
    if (ref !== undefined && (typeof ref !== "string" || ref.length === 0)) {
      problems.add(`${path}.ref must be a non-empty string`);
      return;
    }
    if (id !== undefined && !isPositiveInteger(id)) {
      problems.add(`${path}.id must be the id of an existing ${entity}`);
      return;
    }
    const key = ref !== undefined ? `ref:${ref}` : `${entity}:${id}`;
    if (seen.has(key)) {
      problems.add(`${path} repeats an object already in this submission`);
      return;
    }
    seen.add(key);
    if (withdraw !== undefined && withdraw !== true) {
      problems.add(`${path}.withdraw must be true when present`);
    }
    if (baseUpdatedAt !== undefined && typeof baseUpdatedAt !== "string") {
      problems.add(`${path}.baseUpdatedAt must be a timestamp string`);
    }

    if (withdraw === true) {
      if (fields !== undefined) problems.add(`${path}.fields isn't allowed when withdrawing`);
    } else if (!isRecord(fields) || Object.keys(fields).length === 0) {
      problems.add(`${path}.fields must be an object with at least one field`);
      return;
    } else {
      for (const [name, value] of Object.entries(fields)) {
        checkFieldValue(entity as SubmissionEntity, name, value, `${path}.fields.${name}`, files, problems);
      }
    }

    objects.push({
      path,
      entity: entity as SubmissionEntity,
      ref: typeof ref === "string" ? ref : null,
      id: isPositiveInteger(id) ? id : null,
      withdraw: withdraw === true,
      baseUpdatedAt: typeof baseUpdatedAt === "string" ? baseUpdatedAt : null,
      // Copied so storing files can replace placeholders without changing the caller's object.
      fields: isRecord(fields) ? { ...fields } : {},
    });
  });

  problems.throwIfAny();
  return objects;
}

/** An account's object while a request is applied to it; `original` is the stored row, if any. */
type Working = {
  original: SubmissionObject | null;
  entity: SubmissionEntity;
  ref: string | null;
  targetId: number | null;
  fields: Record<string, unknown>;
  baseUpdatedAt: string | null;
  state: SubmissionState;
  deleted: boolean;
  /** Proposed in this request. */
  received: boolean;
};

function fromRow(row: SubmissionObject): Working {
  return {
    original: row,
    entity: row.entity,
    ref: row.ref,
    targetId: row.targetId,
    fields: row.fields,
    baseUpdatedAt: row.baseUpdatedAt,
    state: row.state,
    deleted: false,
    received: false,
  };
}

/** Takes an object out of review: a published object stays published; anything else is removed. */
function withdrawWorking(working: Working) {
  if (working.ref !== null && working.targetId !== null) {
    working.state = "published";
  } else {
    working.deleted = true;
  }
  working.received = false;
}

function isLive(working: Working) {
  return !working.deleted && (working.state === "pending" || working.targetId !== null);
}

async function loadAccountObjects(db: Kysely<DB>, uid: string, refs: string[], targets: Map<SubmissionEntity, number[]>) {
  const rows = new Map<number, SubmissionObject>();
  const add = (found: Selectable<Submission>[]) => found.forEach((row) => rows.set(row.id, toSubmissionObject(row)));

  add(await db.selectFrom("submission").selectAll().where("uid", "=", uid).where("state", "=", "pending").execute());
  for (const refChunk of chunk([...new Set(refs)], MAX_IDS_PER_QUERY)) {
    add(await db.selectFrom("submission").selectAll().where("uid", "=", uid).where("ref", "in", refChunk).execute());
  }
  for (const [entity, ids] of targets) {
    for (const idChunk of chunk([...new Set(ids)], MAX_IDS_PER_QUERY)) {
      add(await db.selectFrom("submission").selectAll()
        .where("uid", "=", uid)
        .where("entity", "=", entity)
        .where("target_id", "in", idChunk)
        .execute());
    }
  }
  return [...rows.values()];
}

export type ReceivedObject = {
  entity: SubmissionEntity;
  ref: string | null;
  id: number | null;
  /** pending: in review; unchanged: matches the published record, so nothing is queued; withdrawn: nothing in review. */
  state: "pending" | "unchanged" | "withdrawn";
};

/**
 * Applies a request's objects to the account's proposals: each one is merged
 * field by field into that object's pending proposal (newest value wins), or
 * starts one. An object the account already published becomes an edit of its
 * record; a proposal that matches the record is dropped; `withdraw` takes an
 * object out of review. Files are stored once per content hash, with the topo
 * images (see topoFiles.server.ts); a raster no proposal or topo uses any more is
 * deleted.
 */
export async function receiveObjects(
  context: AppLoadContext,
  { uid, source, payload, files }: { uid: string; source: string; payload: unknown; files: Map<string, File> },
): Promise<ReceivedObject[]> {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;
  const incoming = parseObjects(payload, files);
  const problems = new Problems();

  // Images are measured and hashed before anything is stored; a topo's size is its background's.
  const sizes = new Map<string, ImageSize>();
  const hashes = new Map<string, string>();
  for (const object of incoming) {
    for (const [field, value] of Object.entries(object.fields)) {
      if (SUBMISSION_FIELDS[object.entity][field].kind !== "file") continue;
      const fileName = (value as string).slice(FILE_PLACEHOLDER_PREFIX.length);
      if (sizes.has(fileName)) continue;
      const file = files.get(fileName)!;
      try {
        sizes.set(fileName, await measureImage(file));
        hashes.set(fileName, await calculateFileHash(await file.arrayBuffer()));
      } catch (error) {
        if (!(error instanceof ImageSizeError)) throw error;
        problems.add(`${object.path}.fields.${field} ${error.message}`);
      }
    }
  }
  problems.throwIfAny();

  // Everything the request names, and everything it references, by ref or by record.
  const refs = incoming.flatMap((object) => (object.ref ? [object.ref] : []));
  const targets = new Map<SubmissionEntity, number[]>();
  const addTarget = (entity: SubmissionEntity, id: number) => targets.set(entity, [...(targets.get(entity) ?? []), id]);
  for (const object of incoming) {
    if (object.id) addTarget(object.entity, object.id);
    mapReferences(object.entity, object.fields, (value, target) => {
      if (typeof value === "string") refs.push(value);
      else addTarget(target, value);
      return value;
    });
  }

  const workings = (await loadAccountObjects(db, uid, refs, targets)).map(fromRow);
  const byRef = new Map(workings.filter((w) => w.ref !== null).map((w) => [w.ref!, w]));
  const byTarget = new Map(workings.filter((w) => w.targetId !== null).map((w) => [`${w.entity}:${w.targetId}`, w]));
  const results: { object: IncomingObject; working: Working | null }[] = [];

  for (const object of incoming) {
    let working = object.ref !== null ? byRef.get(object.ref) : byTarget.get(`${object.entity}:${object.id}`);
    if (working && working.entity !== object.entity) {
      problems.add(`${object.path}.ref "${object.ref}" is your ${working.entity}, not a ${object.entity}`);
      continue;
    }

    if (object.withdraw) {
      if (working?.state === "pending" && !working.deleted) withdrawWorking(working);
      results.push({ object, working: working ?? null });
      continue;
    }

    if (!working) {
      working = {
        original: null,
        entity: object.entity,
        ref: object.ref,
        targetId: object.id,
        fields: {},
        baseUpdatedAt: null,
        state: "pending",
        deleted: false,
        received: false,
      };
      workings.push(working);
      if (working.ref !== null) byRef.set(working.ref, working);
      if (working.targetId !== null) byTarget.set(`${working.entity}:${working.targetId}`, working);
    }
    const stillPending = working.state === "pending" && !working.deleted;
    working.fields = stillPending ? { ...working.fields, ...object.fields } : { ...object.fields };
    working.baseUpdatedAt = object.baseUpdatedAt ?? (stillPending ? working.baseUpdatedAt : null);
    working.state = "pending";
    working.deleted = false;
    working.received = true;
    results.push({ object, working });
  }
  problems.throwIfAny();

  // References to the account's objects become record ids once those are published.
  const resolve = (value: SubmissionRef, target: SubmissionEntity, path: string): SubmissionRef => {
    if (typeof value === "number") return value;
    const referenced = byRef.get(value);
    if (!referenced || !isLive(referenced)) {
      problems.add(`${path} refers to "${value}", which isn't a ${target} you've proposed`);
      return value;
    }
    if (referenced.entity !== target) {
      problems.add(`${path} refers to "${value}", which is your ${referenced.entity}, not a ${target}`);
      return value;
    }
    return referenced.targetId ?? value;
  };
  for (const working of workings.filter((w) => w.received)) {
    const path = results.find((result) => result.working === working)!.object.path;
    working.fields = mapReferences(working.entity, working.fields, (value, target, at) => resolve(value, target, `${path}.${at}`));
  }
  // Untouched proposals still need their references, which a withdrawal can remove.
  for (const working of workings.filter((w) => !w.received && w.state === "pending" && !w.deleted)) {
    mapReferences(working.entity, working.fields, (value, target, at) =>
      resolve(value, target, `your pending ${working.entity} "${working.ref ?? working.targetId}" ${at}`));
  }
  problems.throwIfAny();

  // Edits: the record must exist; a proposal that matches it is dropped.
  const edits = workings.filter((w) => w.received && w.targetId !== null);
  const records = new Map<string, Record<string, unknown>>();
  for (const entity of ENTITY_ORDER) {
    const ids = edits.filter((w) => w.entity === entity).map((w) => w.targetId!);
    for (const [id, row] of await loadAuditRows(db, entity, ids)) records.set(`${entity}:${id}`, row);
  }
  for (const working of edits) {
    const path = results.find((result) => result.working === working)!.object.path;
    const record = records.get(`${working.entity}:${working.targetId}`);
    if (!record) {
      problems.add(`${path} refers to ${working.entity} ${working.targetId}, which doesn't exist`);
      continue;
    }
    if ("uuid" in working.fields && working.fields.uuid !== record.uuid) {
      problems.add(`${path}.fields.uuid can't be changed`);
    }
    // An image the record already has, by content, is proposed as the record's own file.
    for (const [field, value] of Object.entries(working.fields)) {
      if (SUBMISSION_FIELDS[working.entity][field].kind !== "file" || typeof value !== "string") continue;
      const current = record[SUBMISSION_FIELDS[working.entity][field].column] as string;
      const currentHash = hashFromUrl(current) ?? (record[TOPO_FILES[field].hashColumn] as string | null);
      const proposedHash = value.startsWith(FILE_PLACEHOLDER_PREFIX)
        ? hashes.get(value.slice(FILE_PLACEHOLDER_PREFIX.length))
        : hashFromUrl(value);
      if (currentHash === null || proposedHash !== currentHash) continue;
      working.fields[field] = current;
      if (field === "background") {
        // The record's size stays with its background.
        delete working.fields.imageWidth;
        delete working.fields.imageHeight;
      }
    }
    const unchanged = Object.entries(working.fields).every(([field, value]) =>
      TOPO_FILES[field]?.derived
      || sameFieldValue(working.entity, field, recordFieldValue(working.entity, field, record), value));
    if (unchanged) {
      const original = working.original;
      if (original?.state === "pending") {
        withdrawWorking(working);
      } else if (original) {
        Object.assign(working, fromRow(original));
      } else {
        working.deleted = true;
      }
      working.received = false;
    }
  }

  // New objects: required fields, records they point to, and topo uuids.
  const existence = new Map<SubmissionEntity, Map<number, string>>();
  const topoUuids = new Map<string, string>();
  for (const working of workings.filter((w) => w.received)) {
    const path = results.find((result) => result.working === working)!.object.path;
    mapReferences(working.entity, working.fields, (value, target, at) => {
      if (typeof value === "number") {
        existence.set(target, (existence.get(target) ?? new Map()).set(value, `${path}.${at}`));
      }
      return value;
    });
    if (working.targetId !== null) continue;
    for (const required of REQUIRED_ON_CREATE[working.entity]) {
      if (working.fields[required] === undefined || working.fields[required] === null) {
        problems.add(`${path}.fields.${required} is required for a new ${working.entity}`);
      }
    }
    if (working.entity === "topo" && typeof working.fields.uuid === "string") {
      topoUuids.set(working.fields.uuid, `${path}.fields.uuid`);
    }
  }
  for (const [entity, ids] of existence) {
    for (const idChunk of chunk([...ids.keys()], MAX_IDS_PER_QUERY)) {
      const found = new Set((await db.selectFrom(entity).select("id").where("id", "in", idChunk).execute()).map((row) => Number(row.id)));
      idChunk.filter((id) => !found.has(id)).forEach((id) => problems.add(`${ids.get(id)} refers to ${entity} ${id}, which doesn't exist`));
    }
  }
  for (const uuidChunk of chunk([...topoUuids.keys()], MAX_IDS_PER_QUERY)) {
    for (const { uuid, id } of await db.selectFrom("topo").select(["uuid", "id"]).where("uuid", "in", uuidChunk).execute()) {
      problems.add(`${topoUuids.get(uuid)} "${uuid}" belongs to topo ${id}; propose it with that id instead`);
    }
  }
  problems.throwIfAny();

  // Store files, then the proposals. Files are content-addressed, so sending one
  // again reuses the stored copy.
  const uploaded = new Map<string, { url: string; created: boolean }>();
  const now = formatSqliteTimestamp();
  try {
    for (const working of workings.filter((w) => w.received)) {
      for (const [field, value] of Object.entries(working.fields)) {
        if (SUBMISSION_FIELDS[working.entity][field].kind !== "file" || typeof value !== "string") continue;
        if (!value.startsWith(FILE_PLACEHOLDER_PREFIX)) continue;
        const fileName = value.slice(FILE_PLACEHOLDER_PREFIX.length);
        const { keyPrefix } = TOPO_FILES[field];
        let stored = uploaded.get(`${keyPrefix}/${fileName}`);
        if (!stored) {
          const result = await uploadFileToR2(
            context,
            files.get(fileName)!,
            env.TOPOS_BUCKET_NAME,
            env.TOPOS_BUCKET_DOMAIN,
            { keyPrefix, useContentHash: true },
          );
          stored = { url: result.url, created: result.created };
          uploaded.set(`${keyPrefix}/${fileName}`, stored);
        }
        working.fields[field] = stored.url;
        if (field === "background") {
          const { width, height } = sizes.get(fileName)!;
          working.fields.imageWidth = width;
          working.fields.imageHeight = height;
        }
      }
    }

    for (const working of workings) {
      const { original } = working;
      if (working.deleted) {
        if (original) await db.deleteFrom("submission").where("id", "=", original.id).execute();
        continue;
      }
      const values = {
        fields: toStoredJson(working.fields),
        base_updated_at: working.baseUpdatedAt,
        state: working.state,
        error: null,
        updated_at: now,
        ...(working.received ? { received_at: now, decided_at: null } : {}),
      };
      if (!original) {
        await db.insertInto("submission")
          .values({ ...values, uid, source, entity: working.entity, ref: working.ref, target_id: working.targetId, received_at: now })
          .execute();
      } else if (working.received || working.state !== original.state) {
        await db.updateTable("submission").set({ ...values, source }).where("id", "=", original.id).execute();
      }
    }
  } catch (error) {
    // Only files this request added, and only if nothing stored uses them.
    await removeUnusedTopoFiles(context, [...uploaded.values()].filter((stored) => stored.created).map((stored) => stored.url));
    throw error;
  }

  // Rasters the account's proposals no longer use, and copies of an image now
  // stored under another key. Replaced backgrounds are otherwise kept.
  await removeUnusedTopoFiles(context, workings.flatMap(({ original, entity, fields }) =>
    Object.entries(original?.fields ?? {}).flatMap(([field, value]) => {
      if (SUBMISSION_FIELDS[entity][field].kind !== "file" || typeof value !== "string") return [];
      const replacement = fields[field];
      const copied = typeof replacement === "string" && replacement !== value
        && hashFromUrl(value) !== null && hashFromUrl(value) === hashFromUrl(replacement);
      return TOPO_FILES[field].derived || copied ? [value] : [];
    })));

  return results.map(({ object, working }) => ({
    entity: object.entity,
    ref: object.ref,
    id: working?.targetId ?? object.id,
    state: working && !working.deleted && working.state === "pending"
      ? "pending"
      : object.withdraw ? "withdrawn" : "unchanged",
  }));
}

/** One of the caller's objects, as reported to the submitting app. */
export type MyObject = {
  entity: SubmissionEntity;
  ref: string | null;
  /** The TABVAR record, once there is one. */
  id: number | null;
  state: SubmissionState;
  /** The latest proposed fields. */
  fields: Record<string, unknown>;
  /** Set when approving this object failed; it stays in review. */
  error: string | null;
  receivedAt: string;
  decidedAt: string | null;
};

/**
 * Lists the caller's objects, whatever their role, changed since `since` (all
 * of them when omitted). Pass serverTime back as `since` on the next call.
 */
export async function listMyObjects(
  context: AppLoadContext,
  { uid, since }: { uid: string; since: string | null },
): Promise<{ objects: MyObject[]; serverTime: string }> {
  const db = getDB(context);
  const rows = await db.selectFrom("submission")
    .selectAll()
    .where("uid", "=", uid)
    .$if(since !== null, (qb) => qb.where("updated_at", ">=", since!))
    .orderBy("updated_at")
    .orderBy("id")
    .execute();

  return {
    objects: rows.map(toSubmissionObject).map((object) => ({
      entity: object.entity,
      ref: object.ref,
      id: object.targetId,
      state: object.state,
      fields: object.fields,
      error: object.error,
      receivedAt: object.receivedAt,
      decidedAt: object.decidedAt,
    })),
    serverTime: rows.at(-1)?.updated_at ?? since ?? formatSqliteTimestamp(),
  };
}
