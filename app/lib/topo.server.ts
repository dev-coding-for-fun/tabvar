import type { AppLoadContext } from "react-router";
import { getDB } from "./db";
import { uploadFileToR2 } from "./s3.server";
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

export interface SaveTopoRouteInput {
  routeId: number;
  label?: string | null;
  sortOrder?: number;
}

export interface SaveRawTopoPayload {
  id?: number;
  uuid?: string;
  cragId?: number | null;
  sectorId?: number | null;
  name: string;
  description?: string | null;
  backgroundUrl?: string | null;
  rasterUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageFileSize?: number | null;
  annotations?: TopoAnnotationDocument | unknown[];
  routes?: SaveTopoRouteInput[];
  status?: string;
}

export interface SaveRawTopoInput {
  uid: string;
  backgroundFile?: File | Blob | null;
  rasterFile?: File | Blob | null;
  payload: SaveRawTopoPayload;
}

export function parseSaveRawTopoPayload(data: unknown): SaveRawTopoPayload {
  if (!data || typeof data !== "object") {
    throw new TopoValidationError("Topo payload must be a JSON object.");
  }
  const obj = data as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) {
    throw new TopoValidationError("Topo name is required.");
  }

  let routes: SaveTopoRouteInput[] | undefined = undefined;
  if (Array.isArray(obj.routes)) {
    routes = obj.routes.map((r, index) => {
      if (!r || typeof r !== "object" || typeof (r as Record<string, unknown>).routeId !== "number") {
        throw new TopoValidationError(`Route at index ${index} must have a numeric routeId.`);
      }
      const item = r as Record<string, unknown>;
      return {
        routeId: item.routeId as number,
        label: typeof item.label === "string" ? item.label : null,
        sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index + 1,
      };
    });
  }

  let id: number | undefined = undefined;
  if (typeof obj.id === "number") {
    id = obj.id;
  } else if (typeof obj.id === "string" && !isNaN(Number(obj.id)) && obj.id.trim().length > 0) {
    id = Number(obj.id);
  }

  let uuid: string | undefined = undefined;
  if (typeof obj.uuid === "string" && obj.uuid.trim().length > 0) {
    uuid = obj.uuid.trim();
  } else if (typeof obj.id === "string" && isNaN(Number(obj.id)) && obj.id.trim().length > 0) {
    uuid = obj.id.trim();
  }

  return {
    id,
    uuid,
    cragId: typeof obj.cragId === "number" ? obj.cragId : null,
    sectorId: typeof obj.sectorId === "number" ? obj.sectorId : null,
    name,
    description: typeof obj.description === "string" ? obj.description : null,
    backgroundUrl: typeof obj.backgroundUrl === "string" ? obj.backgroundUrl : null,
    rasterUrl: typeof obj.rasterUrl === "string" ? obj.rasterUrl : null,
    imageWidth: typeof obj.imageWidth === "number" ? obj.imageWidth : null,
    imageHeight: typeof obj.imageHeight === "number" ? obj.imageHeight : null,
    imageFileSize: typeof obj.imageFileSize === "number" ? obj.imageFileSize : null,
    annotations: normalizeAnnotationDocument(obj.annotations as TopoAnnotationDocument | unknown[] | undefined),
    routes,
    status: typeof obj.status === "string" ? obj.status : "Active",
  };
}


export async function saveRawTopo(
  context: AppLoadContext,
  { uid: _uid, backgroundFile, rasterFile, payload }: SaveRawTopoInput,
): Promise<Topo> {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;

  if (!payload.name || typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new TopoValidationError("Topo name is required.");
  }

  let existing = undefined;
  if (typeof payload.id === "number") {
    existing = await db
      .selectFrom("topo")
      .selectAll()
      .where("id", "=", payload.id)
      .executeTakeFirst();
  }
  if (!existing && payload.uuid) {
    existing = await db
      .selectFrom("topo")
      .selectAll()
      .where("uuid", "=", payload.uuid)
      .executeTakeFirst();
  }

  let backgroundUrl = payload.backgroundUrl ?? existing?.background_image_url ?? null;
  let backgroundHash = existing?.background_image_hash ?? null;
  let rasterUrl = payload.rasterUrl ?? existing?.raster_image_url ?? null;
  let rasterHash = existing?.raster_image_hash ?? null;
  let imageWidth = payload.imageWidth ?? existing?.image_width ?? null;
  let imageHeight = payload.imageHeight ?? existing?.image_height ?? null;
  let imageFileSize = payload.imageFileSize ?? existing?.image_file_size ?? null;

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

  if (!backgroundUrl) {
    throw new TopoValidationError("Background image is required.");
  }

  if (!rasterUrl) {
    throw new TopoValidationError("Raster image is required.");
  }

  const annotationsDoc = normalizeAnnotationDocument(
    payload.annotations ?? (existing ? parseAnnotationsJson(existing.annotations_json) : null),
  );
  const annotationsJson = JSON.stringify(annotationsDoc);
  const status = payload.status ?? existing?.status ?? "Active";

  const now = formatSqliteTimestamp();
  let topoId: number;

  if (existing) {
    topoId = existing.id;
    await db
      .updateTable("topo")
      .set({
        name: payload.name.trim(),
        description: payload.description !== undefined ? payload.description : existing.description,
        crag_id: payload.cragId !== undefined ? payload.cragId : existing.crag_id,
        sector_id: payload.sectorId !== undefined ? payload.sectorId : existing.sector_id,
        background_image_url: backgroundUrl,
        background_image_hash: backgroundHash,
        raster_image_url: rasterUrl,
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
        name: payload.name.trim(),
        description: payload.description ?? null,
        crag_id: payload.cragId ?? null,
        sector_id: payload.sectorId ?? null,
        background_image_url: backgroundUrl,
        background_image_hash: backgroundHash,
        raster_image_url: rasterUrl,
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

  // 3. Update route_topo junction if routes list provided
  if (Array.isArray(payload.routes)) {
    await db
      .deleteFrom("route_topo")
      .where("topo_id", "=", topoId)
      .execute();

    if (payload.routes.length > 0) {
      const routeRows = payload.routes.map((r, index) => ({
        topo_id: topoId,
        route_id: r.routeId,
        label: r.label ?? null,
        sort_order: r.sortOrder ?? index + 1,
        created_at: now,
      }));

      await db
        .insertInto("route_topo")
        .values(routeRows)
        .execute();
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

  const topoIds = topoRows.map((t) => t.id);

  const routeRows = await db
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
    .execute();

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
