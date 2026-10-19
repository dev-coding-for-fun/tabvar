import type { Kysely } from "kysely";
import { loadAuditRows } from "./audit.server";
import type { DB } from "./db.d";
import {
  recordFieldValue,
  sameFieldValue,
  SUBMISSION_FIELDS,
  type SubmissionEntity,
  type SubmissionObject,
  type SubmissionTopoRoute,
} from "./submission.server";

/**
 * Builds what the review page shows for a chain of pending objects. Current values
 * are read live from the main tables each time, so an edit always compares against
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
  /** The object's id. */
  key: number;
  entity: SubmissionEntity;
  isNew: boolean;
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
  /** Why approving this object last failed. */
  error: string | null;
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
  imageWidth: "Image width (px)",
  imageHeight: "Image height (px)",
  routes: "Routes on topo",
};

const RICH_TEXT_FIELDS = new Set(["notes", "description"]);

export function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field;
}

type Row = Record<string, unknown>;
type Rows = Record<SubmissionEntity, Map<number, Row>>;

export function countChanges(objects: SubmissionObject[]): ChangeCounts {
  return {
    creates: objects.filter((object) => object.targetId === null).length,
    edits: objects.filter((object) => object.targetId !== null).length,
  };
}

function rowName(row: Row | undefined) {
  return typeof row?.name === "string" ? row.name : null;
}

class ViewBuilder {
  private readonly createsByRef = new Map<string, SubmissionObject>();

  constructor(objects: SubmissionObject[], private readonly rows: Rows) {
    for (const object of objects) {
      if (object.targetId === null && object.ref) this.createsByRef.set(object.ref, object);
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

  change(object: SubmissionObject): ChangeView {
    const base = {
      key: object.id,
      entity: object.entity,
      isNew: object.targetId === null,
      ref: object.ref,
      id: object.targetId,
      error: object.error,
    };
    const fieldNames = Object.keys(object.fields);
    const proposedFields = () => fieldNames.map((field) => ({
      name: field,
      label: fieldLabel(field),
      proposed: this.display(object.entity, field, object.fields[field]),
    }));

    if (object.targetId === null) {
      const name = object.fields.name;
      return {
        ...base,
        title: `New ${object.entity}${typeof name === "string" ? ` “${name}”` : ""}`,
        location: null,
        fields: proposedFields(),
        unchangedCount: 0,
        missing: false,
      };
    }

    const row = this.rows[object.entity].get(object.targetId);
    if (!row) {
      return {
        ...base,
        title: `Edit ${object.entity} ${object.targetId}`,
        location: null,
        fields: proposedFields(),
        unchangedCount: 0,
        missing: true,
      };
    }

    const fields: FieldView[] = [];
    let unchangedCount = 0;
    for (const field of fieldNames) {
      const current = recordFieldValue(object.entity, field, row);
      const proposed = object.fields[field];
      if (sameFieldValue(object.entity, field, current, proposed)) {
        unchangedCount += 1;
        continue;
      }
      fields.push({
        name: field,
        label: fieldLabel(field),
        current: this.display(object.entity, field, current),
        proposed: this.display(object.entity, field, proposed),
      });
    }

    return {
      ...base,
      title: `Edit ${object.entity} “${rowName(row) ?? object.targetId}”`,
      location: this.location(object.entity, row),
      fields,
      unchangedCount,
      missing: false,
    };
  }
}

function collectIds(objects: SubmissionObject[]): Record<SubmissionEntity, Set<number>> {
  const ids: Record<SubmissionEntity, Set<number>> = {
    crag: new Set(), sector: new Set(), route: new Set(), topo: new Set(),
  };
  for (const object of objects) {
    if (object.targetId !== null) ids[object.entity].add(object.targetId);
    for (const [name, value] of Object.entries(object.fields)) {
      const spec = SUBMISSION_FIELDS[object.entity][name];
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

/** Describes each object in a chain for review, against the current records. */
export async function describeObjects(db: Kysely<DB>, objects: SubmissionObject[]): Promise<ChangeView[]> {
  const ids = collectIds(objects);
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

  const builder = new ViewBuilder(objects, rows);
  return objects.map((object) => builder.change(object));
}
