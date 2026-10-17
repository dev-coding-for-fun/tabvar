import type { Kysely } from "kysely";
import { loadAuditRows } from "./audit.server";
import type { DB } from "./db.d";
import {
  SUBMISSION_FIELDS,
  type SubmissionChange,
  type SubmissionEntity,
  type SubmissionPayload,
  type SubmissionTopoRoute,
} from "./submission.server";

/**
 * Builds what the review page shows for a queued submission. Current values are
 * read live from the main tables each time, so an edit always compares against
 * what's published now.
 */

export type RecordRef = { entity: SubmissionEntity; id: number | null; label: string; isNew: boolean };

export type DisplayValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "richText"; html: string }
  | { kind: "record"; record: RecordRef }
  | { kind: "image"; url: string }
  | { kind: "routes"; routes: { label: string | null; record: RecordRef }[] }
  | { kind: "annotations"; count: number };

export type FieldView = {
  name: string;
  label: string;
  /** Present for edits. */
  current?: DisplayValue;
  proposed: DisplayValue;
};

export type ChangeView = {
  index: number;
  entity: SubmissionEntity;
  op: SubmissionChange["op"];
  ref: string | null;
  id: number | null;
  title: string;
  /** Where an existing record sits, e.g. "Crag › Sector". */
  location: string | null;
  /** For edits, only fields whose proposed value differs from the current one. */
  fields: FieldView[];
  /** Proposed fields that already match the current value. */
  unchangedCount: number;
  /** An edit whose record no longer exists. */
  missing: boolean;
};

export type ChangeCounts = { creates: number; edits: number };

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  notes: "Notes",
  latitude: "Latitude",
  longitude: "Longitude",
  cragId: "Crag",
  sectorId: "Sector",
  sortOrder: "Sort order",
  altNames: "Alternate names",
  gradeYds: "Grade",
  climbStyle: "Style",
  boltCount: "Bolts",
  pitchCount: "Pitches",
  routeLength: "Length (m)",
  firstAscentBy: "First ascent by",
  firstAscentDate: "First ascent date",
  routeBuiltDate: "Built",
  year: "Year",
  status: "Status",
  uuid: "UUID",
  description: "Description",
  annotations: "Annotations",
  background: "Background image",
  raster: "Topo image",
  routes: "Routes on topo",
};

const RICH_TEXT_FIELDS = new Set(["notes", "description"]);

export function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field;
}

type Row = Record<string, unknown>;
type Rows = Record<SubmissionEntity, Map<number, Row>>;

export function countChanges(payload: SubmissionPayload): ChangeCounts {
  return {
    creates: payload.changes.filter((change) => change.op === "create").length,
    edits: payload.changes.filter((change) => change.op === "update").length,
  };
}

function sameValue(a: unknown, b: unknown) {
  const left = a ?? null;
  const right = b ?? null;
  if (left === right) return true;
  return typeof left === "object" && typeof right === "object" && JSON.stringify(left) === JSON.stringify(right);
}

function rowName(row: Row | undefined) {
  return typeof row?.name === "string" ? row.name : null;
}

class ViewBuilder {
  private readonly createsByRef = new Map<string, SubmissionChange>();

  constructor(payload: SubmissionPayload, private readonly rows: Rows) {
    for (const change of payload.changes) {
      if (change.op === "create" && change.ref) this.createsByRef.set(change.ref, change);
    }
  }

  record(entity: SubmissionEntity, value: unknown): RecordRef {
    if (typeof value === "string") {
      const name = this.createsByRef.get(value)?.fields.name;
      return { entity, id: null, isNew: true, label: typeof name === "string" ? name : value };
    }
    const id = Number(value);
    return { entity, id, isNew: false, label: rowName(this.rows[entity].get(id)) ?? `${entity} ${id}` };
  }

  display(entity: SubmissionEntity, name: string, value: unknown): DisplayValue {
    const spec = SUBMISSION_FIELDS[entity][name];
    if (value === null || value === undefined || value === "") return { kind: "empty" };

    switch (spec.kind) {
      case "parent":
      case "optionalParent":
        return { kind: "record", record: this.record(spec.parent!, value) };
      case "file":
        return { kind: "image", url: String(value) };
      case "annotations": {
        const document = typeof value === "string" ? JSON.parse(value) : value;
        const items = Array.isArray(document) ? document : document?.items ?? [];
        return { kind: "annotations", count: Array.isArray(items) ? items.length : 0 };
      }
      case "routes":
        return {
          kind: "routes",
          routes: (value as SubmissionTopoRoute[]).map((link) => ({
            label: link.label ?? null,
            record: this.record("route", link.routeId),
          })),
        };
      default:
        return RICH_TEXT_FIELDS.has(name) ? { kind: "richText", html: String(value) } : { kind: "text", text: String(value) };
    }
  }

  /** The current value in the same shape as a proposed one. */
  current(entity: SubmissionEntity, name: string, row: Row): unknown {
    const spec = SUBMISSION_FIELDS[entity][name];
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

  /** Route links compare by route and label; their order is the list order. */
  comparable(entity: SubmissionEntity, name: string, value: unknown): unknown {
    if (SUBMISSION_FIELDS[entity][name].kind !== "routes" || !Array.isArray(value)) return value;
    return (value as SubmissionTopoRoute[]).map((link) => [link.routeId, link.label ?? null]);
  }

  location(entity: SubmissionEntity, row: Row): string | null {
    if (entity === "route") {
      return [row.crag_name, row.sector_name].filter(Boolean).join(" › ") || null;
    }
    if (entity === "sector" || entity === "topo") {
      const parts = [
        rowName(this.rows.crag.get(Number(row.crag_id))),
        entity === "topo" ? rowName(this.rows.sector.get(Number(row.sector_id))) : null,
      ];
      return parts.filter(Boolean).join(" › ") || null;
    }
    return null;
  }

  change(change: SubmissionChange, index: number): ChangeView {
    const base = { index, entity: change.entity, op: change.op, ref: change.ref ?? null, id: change.id ?? null };
    const fieldNames = Object.keys(change.fields);

    if (change.op === "create") {
      const name = change.fields.name;
      return {
        ...base,
        title: `New ${change.entity}${typeof name === "string" ? ` “${name}”` : ""}`,
        location: null,
        fields: fieldNames.map((field) => ({
          name: field,
          label: fieldLabel(field),
          proposed: this.display(change.entity, field, change.fields[field]),
        })),
        unchangedCount: 0,
        missing: false,
      };
    }

    const row = this.rows[change.entity].get(change.id!);
    if (!row) {
      return {
        ...base,
        title: `Edit ${change.entity} ${change.id}`,
        location: null,
        fields: fieldNames.map((field) => ({
          name: field,
          label: fieldLabel(field),
          proposed: this.display(change.entity, field, change.fields[field]),
        })),
        unchangedCount: 0,
        missing: true,
      };
    }

    const fields: FieldView[] = [];
    let unchangedCount = 0;
    for (const field of fieldNames) {
      const current = this.current(change.entity, field, row);
      const proposed = change.fields[field];
      if (sameValue(this.comparable(change.entity, field, current), this.comparable(change.entity, field, proposed))) {
        unchangedCount += 1;
        continue;
      }
      fields.push({
        name: field,
        label: fieldLabel(field),
        current: this.display(change.entity, field, current),
        proposed: this.display(change.entity, field, proposed),
      });
    }

    return {
      ...base,
      title: `Edit ${change.entity} “${rowName(row) ?? change.id}”`,
      location: this.location(change.entity, row),
      fields,
      unchangedCount,
      missing: false,
    };
  }
}

function collectIds(payload: SubmissionPayload): Record<SubmissionEntity, Set<number>> {
  const ids: Record<SubmissionEntity, Set<number>> = {
    crag: new Set(), sector: new Set(), route: new Set(), topo: new Set(),
  };
  for (const change of payload.changes) {
    if (change.op === "update" && change.id) ids[change.entity].add(change.id);
    for (const [name, value] of Object.entries(change.fields)) {
      const spec = SUBMISSION_FIELDS[change.entity][name];
      if (spec?.parent && typeof value === "number") ids[spec.parent].add(value);
      if (spec?.kind === "routes" && Array.isArray(value)) {
        for (const link of value as SubmissionTopoRoute[]) {
          if (typeof link.routeId === "number") ids.route.add(link.routeId);
        }
      }
    }
  }
  return ids;
}

/** Describes each change in a submission for review, against the current records. */
export async function describeSubmissionChanges(db: Kysely<DB>, payload: SubmissionPayload): Promise<ChangeView[]> {
  const ids = collectIds(payload);
  const addIds = (entity: SubmissionEntity, rowsToRead: Map<number, Row>, column: string) => {
    for (const row of rowsToRead.values()) {
      if (typeof row[column] === "number") ids[entity].add(row[column] as number);
    }
  };

  // Loaded children first so the names of their current parents and linked routes can be shown.
  const rows = {} as Rows;
  rows.topo = await loadAuditRows(db, "topo", [...ids.topo]);
  for (const row of rows.topo.values()) {
    for (const link of (row.routes as { route_id: number }[] | undefined) ?? []) ids.route.add(link.route_id);
  }
  rows.route = await loadAuditRows(db, "route", [...ids.route]);
  addIds("sector", rows.topo, "sector_id");
  addIds("sector", rows.route, "sector_id");
  rows.sector = await loadAuditRows(db, "sector", [...ids.sector]);
  addIds("crag", rows.topo, "crag_id");
  addIds("crag", rows.sector, "crag_id");
  rows.crag = await loadAuditRows(db, "crag", [...ids.crag]);

  const builder = new ViewBuilder(payload, rows);
  return payload.changes.map((change, index) => builder.change(change, index));
}
