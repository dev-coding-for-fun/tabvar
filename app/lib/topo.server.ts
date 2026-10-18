import type { AppLoadContext } from "react-router";
import { getDB } from "./db";
import { uploadFileToR2 } from "./s3.server";
import { toStoredJson } from "./storedJson";
import { formatSqliteTimestamp, serverTimeFromUpdatedRows } from "./topoSync.server";
import type {
  Topo,
  RouteTopo,
  TopoAnnotationDocument,
} from "./models";

export class TopoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopoValidationError";
  }
}

export function parseAnnotationsJson(raw: string | null | undefined): TopoAnnotationDocument {
  if (!raw) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.items)) {
      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        items: parsed.items,
      };
    }
    if (Array.isArray(parsed)) {
      return {
        version: 1,
        items: parsed,
      };
    }
  } catch {
    // If invalid JSON, fall back to empty items
  }
  return { version: 1, items: [] };
}

export function normalizeAnnotationDocument(
  input: TopoAnnotationDocument | unknown[] | undefined | null,
): TopoAnnotationDocument {
  if (!input) {
    return { version: 1, items: [] };
  }
  if (Array.isArray(input)) {
    return { version: 1, items: input };
  }
  if (typeof input === "object" && Array.isArray(input.items)) {
    return {
      version: typeof input.version === "number" ? input.version : 1,
      items: input.items,
    };
  }
  return { version: 1, items: [] };
}

export const TOPO_STATUSES = ["Active", "Deleted"] as const;
export type TopoStatus = (typeof TOPO_STATUSES)[number];

// D1 allows at most 100 bound parameters per query; a route_topo row binds 5.
const MAX_IDS_PER_QUERY = 90;
const MAX_LINKS_PER_INSERT = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** A link from a topo to an existing route. New routes are created through submissions. */
export interface SaveTopoRouteInput {
  routeId: number;
  label?: string | null;
  sortOrder?: number;
}

/**
 * A topo to create or update. Omitted fields keep their current values on an
 * update; `null` clears a nullable field.
 */
export interface SaveRawTopoPayload {
  id?: number;
  uuid?: string;
  cragId?: number | null;
  sectorId?: number | null;
  /** Required to create a topo. */
  name?: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  backgroundUrl?: string;
  rasterUrl?: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageFileSize?: number | null;
  annotations?: TopoAnnotationDocument | unknown[];
  /** Replaces all of the topo's route links when present. */
  routes?: SaveTopoRouteInput[];
  status?: TopoStatus;
}

export interface SaveRawTopoInput {
  uid: string;
  backgroundFile?: File | Blob | null;
  rasterFile?: File | Blob | null;
  payload: SaveRawTopoPayload;
}

export class TopoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopoNotFoundError";
  }
}

function optionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new TopoValidationError(`${field} must be an existing id or null.`);
}

function optionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TopoValidationError(`${field} must be a number or null.`);
}

function optionalCoordinate(value: unknown, field: string): number | null | undefined {
  // Multipart requests send coordinates as strings.
  if (typeof value === "string" && value.trim().length > 0 && !isNaN(Number(value))) return Number(value);
  return optionalNumber(value, field);
}

export function parseSaveRawTopoPayload(data: unknown): SaveRawTopoPayload {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TopoValidationError("Topo payload must be a JSON object.");
  }
  const obj = data as Record<string, unknown>;

  let name: string | undefined;
  if (obj.name !== undefined) {
    if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
      throw new TopoValidationError("Topo name must be a non-empty string.");
    }
    name = obj.name.trim();
  }

  let routes: SaveTopoRouteInput[] | undefined;
  if (obj.routes !== undefined) {
    if (!Array.isArray(obj.routes)) {
      throw new TopoValidationError("routes must be an array.");
    }
    const seen = new Set<number>();
    routes = obj.routes.map((r, index) => {
      if (!r || typeof r !== "object") {
        throw new TopoValidationError(`Route at index ${index} must be an object.`);
      }
      const item = r as Record<string, unknown>;
      if (typeof item.routeId !== "number" || !Number.isInteger(item.routeId) || item.routeId <= 0) {
        throw new TopoValidationError(
          `Route at index ${index} needs the routeId of an existing route. Propose new routes through the submissions API.`,
        );
      }
      if (seen.has(item.routeId)) {
        throw new TopoValidationError(`Route ${item.routeId} is linked more than once.`);
      }
      seen.add(item.routeId);
      if (item.label !== undefined && item.label !== null && typeof item.label !== "string") {
        throw new TopoValidationError(`Route at index ${index} has a label that isn't a string.`);
      }
      if (item.sortOrder !== undefined && !Number.isInteger(item.sortOrder)) {
        throw new TopoValidationError(`Route at index ${index} has a sortOrder that isn't an integer.`);
      }
      return {
        routeId: item.routeId,
        label: (item.label as string | null | undefined) ?? null,
        sortOrder: (item.sortOrder as number | undefined) ?? index + 1,
      };
    });
  }

  let id: number | undefined;
  if (typeof obj.id === "number") {
    id = obj.id;
  } else if (typeof obj.id === "string" && !isNaN(Number(obj.id)) && obj.id.trim().length > 0) {
    id = Number(obj.id);
  }

  let uuid: string | undefined;
  if (typeof obj.uuid === "string" && obj.uuid.trim().length > 0) {
    uuid = obj.uuid.trim();
  } else if (typeof obj.id === "string" && isNaN(Number(obj.id)) && obj.id.trim().length > 0) {
    uuid = obj.id.trim();
  }

  for (const field of ["description", "backgroundUrl", "rasterUrl"] as const) {
    const value = obj[field];
    const nullable = field === "description";
    if (value !== undefined && typeof value !== "string" && !(nullable && value === null)) {
      throw new TopoValidationError(`${field} must be a string${nullable ? " or null" : ""}.`);
    }
  }

  if (obj.status !== undefined && !TOPO_STATUSES.includes(obj.status as TopoStatus)) {
    throw new TopoValidationError(`status must be one of ${TOPO_STATUSES.join(", ")}.`);
  }

  return {
    id,
    uuid,
    cragId: optionalId(obj.cragId, "cragId"),
    sectorId: optionalId(obj.sectorId, "sectorId"),
    name,
    description: obj.description as string | null | undefined,
    latitude: optionalCoordinate(obj.latitude !== undefined ? obj.latitude : obj.lat, "latitude"),
    longitude: optionalCoordinate(
      obj.longitude !== undefined ? obj.longitude : obj.lon !== undefined ? obj.lon : obj.lng,
      "longitude",
    ),
    backgroundUrl: obj.backgroundUrl as string | undefined,
    rasterUrl: obj.rasterUrl as string | undefined,
    imageWidth: optionalNumber(obj.imageWidth, "imageWidth"),
    imageHeight: optionalNumber(obj.imageHeight, "imageHeight"),
    imageFileSize: optionalNumber(obj.imageFileSize, "imageFileSize"),
    annotations: obj.annotations === undefined
      ? undefined
      : normalizeAnnotationDocument(obj.annotations as TopoAnnotationDocument | unknown[]),
    routes,
    status: obj.status as TopoStatus | undefined,
  };
}

function hashFromUrl(url: string | null): string | null {
  const match = url?.match(/\/([0-9a-f]{40})(?:\.[a-z0-9]+)?$/i);
  return match ? match[1].toLowerCase() : null;
}

async function findMissingIds(db: ReturnType<typeof getDB>, table: "crag" | "sector" | "route", ids: number[]) {
  const found = new Set<number>();
  for (const idChunk of chunk([...new Set(ids)], MAX_IDS_PER_QUERY)) {
    const rows = await db.selectFrom(table).select("id").where("id", "in", idChunk).execute();
    rows.forEach((row) => found.add(Number(row.id)));
  }
  return ids.filter((id) => !found.has(id));
}

/**
 * Creates or updates a topo. Matches an existing topo by `id` (which must exist)
 * or else by `uuid`; a new `uuid` creates a topo. Checks referenced records and
 * image URLs before uploading anything.
 */
export async function saveRawTopo(
  context: AppLoadContext,
  { backgroundFile, rasterFile, payload }: SaveRawTopoInput,
): Promise<Topo> {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;

  let existing = undefined;
  if (typeof payload.id === "number") {
    existing = await db
      .selectFrom("topo")
      .selectAll()
      .where("id", "=", payload.id)
      .executeTakeFirst();
    if (!existing) {
      throw new TopoNotFoundError(`Topo ${payload.id} doesn't exist.`);
    }
  } else if (payload.uuid) {
    existing = await db
      .selectFrom("topo")
      .selectAll()
      .where("uuid", "=", payload.uuid)
      .executeTakeFirst();
  }

  const name = (payload.name ?? existing?.name)?.trim();
  if (!name) {
    throw new TopoValidationError("Topo name is required.");
  }

  if (payload.cragId && (await findMissingIds(db, "crag", [payload.cragId])).length > 0) {
    throw new TopoValidationError(`Crag ${payload.cragId} doesn't exist.`);
  }
  if (payload.sectorId && (await findMissingIds(db, "sector", [payload.sectorId])).length > 0) {
    throw new TopoValidationError(`Sector ${payload.sectorId} doesn't exist.`);
  }
  const missingRoutes = await findMissingIds(db, "route", (payload.routes ?? []).map((route) => route.routeId));
  if (missingRoutes.length > 0) {
    throw new TopoValidationError(`Route ${missingRoutes.join(", ")} doesn't exist.`);
  }

  // Images must be uploaded with the request or already stored in the topo bucket.
  for (const [field, url, current] of [
    ["backgroundUrl", payload.backgroundUrl, existing?.background_image_url],
    ["rasterUrl", payload.rasterUrl, existing?.raster_image_url],
  ] as const) {
    if (url && url !== current && !url.startsWith(`${env.TOPOS_BUCKET_DOMAIN}/`)) {
      throw new TopoValidationError(`${field} must point to an image stored by TABVAR; upload the file instead.`);
    }
  }

  const sameBackground = Boolean(
    existing && !backgroundFile && (!payload.backgroundUrl || payload.backgroundUrl === existing.background_image_url),
  );
  const sameRaster = Boolean(
    existing && !rasterFile && (!payload.rasterUrl || payload.rasterUrl === existing.raster_image_url),
  );

  let backgroundUrl = payload.backgroundUrl ?? existing?.background_image_url ?? null;
  let backgroundHash = sameBackground ? existing!.background_image_hash : hashFromUrl(backgroundUrl);
  let rasterUrl = payload.rasterUrl ?? existing?.raster_image_url ?? null;
  let rasterHash = sameRaster ? existing!.raster_image_hash : hashFromUrl(rasterUrl);
  const imageWidth = payload.imageWidth ?? (sameBackground ? existing?.image_width : null) ?? null;
  const imageHeight = payload.imageHeight ?? (sameBackground ? existing?.image_height : null) ?? null;
  let imageFileSize = payload.imageFileSize ?? (sameBackground ? existing?.image_file_size : null) ?? null;

  if (!backgroundUrl && !(backgroundFile && backgroundFile.size > 0)) {
    throw new TopoValidationError("Background image is required.");
  }
  if (!rasterUrl && !(rasterFile && rasterFile.size > 0)) {
    throw new TopoValidationError("Raster image is required.");
  }

  // 1. Upload background file if provided
  if (backgroundFile && backgroundFile.size > 0) {
    const uploadResult = await uploadFileToR2(
      context,
      backgroundFile,
      env.TOPOS_BUCKET_NAME,
      env.TOPOS_BUCKET_DOMAIN,
      { keyPrefix: "topos/raw", useContentHash: true },
    );
    backgroundUrl = uploadResult.url;
    backgroundHash = uploadResult.hash ?? null;
    imageFileSize = uploadResult.size ?? imageFileSize;
  }

  // 2. Upload raster file if provided
  if (rasterFile && rasterFile.size > 0) {
    const uploadResult = await uploadFileToR2(
      context,
      rasterFile,
      env.TOPOS_BUCKET_NAME,
      env.TOPOS_BUCKET_DOMAIN,
      { keyPrefix: "topos/raster", useContentHash: true },
    );
    rasterUrl = uploadResult.url;
    rasterHash = uploadResult.hash ?? null;
  }

  const annotationsDoc = normalizeAnnotationDocument(
    payload.annotations ?? (existing ? parseAnnotationsJson(existing.annotations_json) : null),
  );
  const annotationsJson = toStoredJson(annotationsDoc);
  const status = payload.status ?? existing?.status ?? "Active";

  const now = formatSqliteTimestamp();
  let topoId: number;

  if (existing) {
    topoId = existing.id;
    await db
      .updateTable("topo")
      .set({
        name,
        description: payload.description !== undefined ? payload.description : existing.description,
        crag_id: payload.cragId !== undefined ? payload.cragId : existing.crag_id,
        sector_id: payload.sectorId !== undefined ? payload.sectorId : existing.sector_id,
        latitude: payload.latitude !== undefined ? payload.latitude : existing.latitude,
        longitude: payload.longitude !== undefined ? payload.longitude : existing.longitude,
        background_image_url: backgroundUrl!,
        background_image_hash: backgroundHash,
        raster_image_url: rasterUrl!,
        raster_image_hash: rasterHash,
        image_width: imageWidth,
        image_height: imageHeight,
        image_file_size: imageFileSize,
        annotations_json: annotationsJson,
        status,
        updated_at: now,
      })
      .where("id", "=", topoId)
      .execute();
  } else {
    const topoUuid = payload.uuid && payload.uuid.trim().length > 0 ? payload.uuid.trim() : crypto.randomUUID();
    const insertResult = await db
      .insertInto("topo")
      .values({
        uuid: topoUuid,
        name,
        description: payload.description ?? null,
        crag_id: payload.cragId ?? null,
        sector_id: payload.sectorId ?? null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        background_image_url: backgroundUrl!,
        background_image_hash: backgroundHash,
        raster_image_url: rasterUrl!,
        raster_image_hash: rasterHash,
        image_width: imageWidth,
        image_height: imageHeight,
        image_file_size: imageFileSize,
        annotations_json: annotationsJson,
        status,
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirst();

    if (insertResult.insertId) {
      topoId = Number(insertResult.insertId);
    } else {
      const inserted = await db.selectFrom("topo").select("id").where("uuid", "=", topoUuid).executeTakeFirst();
      topoId = inserted!.id;
    }
  }

  // 3. Replace the route links if a routes list was provided
  if (payload.routes) {
    await db
      .deleteFrom("route_topo")
      .where("topo_id", "=", topoId)
      .execute();

    const routeRows = payload.routes.map((r, index) => ({
      topo_id: topoId,
      route_id: r.routeId,
      label: r.label ?? null,
      sort_order: r.sortOrder ?? index + 1,
      created_at: now,
    }));
    for (const rowChunk of chunk(routeRows, MAX_LINKS_PER_INSERT)) {
      await db.insertInto("route_topo").values(rowChunk).execute();
    }
  }

  return (await loadTopoById(context, topoId))!;
}

export async function loadTopoById(context: AppLoadContext, idOrUuid: number | string): Promise<Topo | null> {
  const db = getDB(context);

  let query = db.selectFrom("topo").selectAll();
  const isNumeric = typeof idOrUuid === "number" || (!isNaN(Number(idOrUuid)) && String(Number(idOrUuid)) === String(idOrUuid).trim());
  if (isNumeric) {
    query = query.where("id", "=", Number(idOrUuid));
  } else {
    query = query.where("uuid", "=", String(idOrUuid).trim());
  }

  const row = await query.executeTakeFirst();

  if (!row) {
    return null;
  }

  const topoId = row.id;

  const routeRows = await db
    .selectFrom("route_topo")
    .leftJoin("route", "route_topo.route_id", "route.id")
    .where("route_topo.topo_id", "=", topoId)
    .select([
      "route_topo.topo_id as topoId",
      "route_topo.route_id as routeId",
      "route_topo.label as label",
      "route_topo.sort_order as sortOrder",
      "route_topo.created_at as createdAt",
      "route.name as routeName",
    ])
    .orderBy("route_topo.sort_order", "asc")
    .orderBy("route_topo.route_id", "asc")
    .execute();

  const routes: RouteTopo[] = routeRows.map((r) => ({
    topoId: r.topoId,
    routeId: r.routeId,
    label: r.label,
    sortOrder: r.sortOrder,
    routeName: r.routeName,
    createdAt: r.createdAt,
  }));

  return {
    id: row.id,
    uuid: row.uuid,
    cragId: row.crag_id,
    sectorId: row.sector_id,
    name: row.name,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    backgroundImageUrl: row.background_image_url,
    backgroundImageHash: row.background_image_hash,
    rasterImageUrl: row.raster_image_url,
    rasterImageHash: row.raster_image_hash,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageFileSize: row.image_file_size,
    annotations: parseAnnotationsJson(row.annotations_json),
    routes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LoadToposFilter {
  since?: string | null;
  sectorId?: number | null;
  cragId?: number | null;
  status?: string | null;
}

export async function loadTopos(
  context: AppLoadContext,
  filter: LoadToposFilter = {},
): Promise<{ topos: Topo[]; serverTime: string }> {
  const db = getDB(context);

  let query = db.selectFrom("topo").selectAll();

  if (filter.since) {
    query = query.where("topo.updated_at", ">=", filter.since);
  } else {
    // If not syncing with since, default to active topos
    const statusFilter = filter.status ?? "Active";
    query = query.where("topo.status", "=", statusFilter);
  }

  if (filter.sectorId) {
    query = query.where("topo.sector_id", "=", filter.sectorId);
  }

  if (filter.cragId) {
    query = query.where("topo.crag_id", "=", filter.cragId);
  }

  query = query
    .orderBy("topo.updated_at", "asc")
    .orderBy("topo.id", "asc");

  const topoRows = await query.execute();

  if (topoRows.length === 0) {
    return {
      topos: [],
      serverTime: filter.since ?? formatSqliteTimestamp(),
    };
  }

  // Chunked to stay under D1's bound-parameter limit on large pulls.
  const routeRows = [];
  for (const topoIds of chunk(topoRows.map((t) => t.id), MAX_IDS_PER_QUERY)) {
    routeRows.push(...await db
      .selectFrom("route_topo")
      .leftJoin("route", "route_topo.route_id", "route.id")
      .where("route_topo.topo_id", "in", topoIds)
      .select([
        "route_topo.topo_id as topoId",
        "route_topo.route_id as routeId",
        "route_topo.label as label",
        "route_topo.sort_order as sortOrder",
        "route_topo.created_at as createdAt",
        "route.name as routeName",
      ])
      .orderBy("route_topo.sort_order", "asc")
      .orderBy("route_topo.route_id", "asc")
      .execute());
  }

  const routesByTopoId = new Map<number, RouteTopo[]>();
  for (const r of routeRows) {
    const list = routesByTopoId.get(r.topoId) ?? [];
    list.push({
      topoId: r.topoId,
      routeId: r.routeId,
      label: r.label,
      sortOrder: r.sortOrder,
      routeName: r.routeName,
      createdAt: r.createdAt,
    });
    routesByTopoId.set(r.topoId, list);
  }

  const topos: Topo[] = topoRows.map((row) => ({
    id: row.id,
    uuid: row.uuid,
    cragId: row.crag_id,
    sectorId: row.sector_id,
    name: row.name,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    backgroundImageUrl: row.background_image_url,
    backgroundImageHash: row.background_image_hash,
    rasterImageUrl: row.raster_image_url,
    rasterImageHash: row.raster_image_hash,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageFileSize: row.image_file_size,
    annotations: parseAnnotationsJson(row.annotations_json),
    routes: routesByTopoId.get(row.id) ?? [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    topos,
    serverTime: serverTimeFromUpdatedRows(topoRows, filter.since ?? null),
  };
}

export async function deleteTopo(
  context: AppLoadContext,
  idOrUuid: number | string,
): Promise<boolean> {
  const db = getDB(context);
  const now = formatSqliteTimestamp();

  let query = db.updateTable("topo").set({
    status: "Deleted",
    updated_at: now,
  });

  const isNumeric = typeof idOrUuid === "number" || (!isNaN(Number(idOrUuid)) && String(Number(idOrUuid)) === String(idOrUuid).trim());
  if (isNumeric) {
    query = query.where("id", "=", Number(idOrUuid));
  } else {
    query = query.where("uuid", "=", String(idOrUuid).trim());
  }

  const result = await query.executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
}
