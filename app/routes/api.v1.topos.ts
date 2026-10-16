import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
} from "~/lib/apiAuth.server";
import { auditCreatedRows, auditedWrite } from "~/lib/audit.server";
import {
  deleteTopo,
  loadTopoById,
  loadTopos,
  parseSaveRawTopoPayload,
  saveRawTopo,
  TopoValidationError,
} from "~/lib/topo.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  await requireApiTokenUser(request, context, headers);

  const url = new URL(request.url);
  const idOrUuid = url.searchParams.get("id") ?? url.searchParams.get("uuid");
  const since = url.searchParams.get("since");
  const sectorId = url.searchParams.get("sectorId");
  const cragId = url.searchParams.get("cragId");

  if (idOrUuid) {
    const topo = await loadTopoById(context, idOrUuid);
    if (!topo) {
      return apiError("not_found", 404, "Topo not found.", headers);
    }
    return jsonResponse({ topo }, { headers });
  }

  const result = await loadTopos(context, {
    since,
    sectorId: sectorId ? Number(sectorId) : null,
    cragId: cragId ? Number(cragId) : null,
  });

  return jsonResponse(result, { headers });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const tokenUser = await requireApiTokenUser(request, context, headers);

  if (tokenUser.role === "anonymous") {
    return apiError("forbidden", 403, "Anonymous users cannot create or modify topos.", headers);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const idOrUuid = url.searchParams.get("id") ?? url.searchParams.get("uuid");
    if (!idOrUuid) {
      return apiError("bad_request", 400, "Topo id or uuid is required for deletion.", headers);
    }
    const existing = await loadTopoById(context, idOrUuid);
    const success = await auditedWrite(context, {
      author: tokenUser,
      source: "api",
      entity: "topo",
      ids: existing ? [existing.id] : [],
      write: () => deleteTopo(context, idOrUuid),
    });
    return jsonResponse({ success }, { headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use GET or POST for topos.", headers);
  }

  try {
    let backgroundFile: File | null = null;
    let rasterFile: File | null = null;
    let payload: Record<string, unknown> = {};

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const rawBackground = formData.get("background");
      if (rawBackground instanceof File && rawBackground.size > 0) {
        backgroundFile = rawBackground;
      }
      const rawRaster = formData.get("raster");
      if (rawRaster instanceof File && rawRaster.size > 0) {
        rasterFile = rawRaster;
      }
      const rawPayload = formData.get("payload") ?? formData.get("topo");
      if (typeof rawPayload === "string") {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          return apiError("bad_request", 400, "Payload field must be valid JSON.", headers);
        }
      }
      const formLat = formData.get("latitude") ?? formData.get("lat");
      if (formLat !== null && payload.latitude === undefined && payload.lat === undefined) {
        payload.latitude = formLat;
      }
      const formLon = formData.get("longitude") ?? formData.get("lon") ?? formData.get("lng");
      if (
        formLon !== null &&
        payload.longitude === undefined &&
        payload.lon === undefined &&
        payload.lng === undefined
      ) {
        payload.longitude = formLon;
      }
    } else {
      try {
        payload = (await request.json()) as Record<string, unknown>;
      } catch {
        return apiError(
          "bad_request",
          400,
          "Request body must be valid JSON or multipart/form-data.",
          headers,
        );
      }
    }

    const parsedPayload = parseSaveRawTopoPayload(payload);

    // saveRawTopo matches an existing topo by id first, then uuid.
    const existing = (parsedPayload.id !== undefined ? await loadTopoById(context, parsedPayload.id) : null)
      ?? (parsedPayload.uuid ? await loadTopoById(context, parsedPayload.uuid) : null);
    const author = { uid: tokenUser.uid, displayName: tokenUser.displayName };

    const topo = await auditedWrite(context, {
      author,
      source: "api",
      entity: "topo",
      ids: existing ? [existing.id] : [],
      write: () => saveRawTopo(context, {
        uid: tokenUser.uid,
        backgroundFile,
        rasterFile,
        payload: parsedPayload,
      }),
      createdIds: (saved) => [saved.id],
    });

    // Route entries without a routeId were created by saveRawTopo.
    if (parsedPayload.routes) {
      const linkedRouteIds = new Set(parsedPayload.routes.map((route) => route.routeId));
      await auditCreatedRows(context, {
        author,
        source: "api",
        entity: "route",
        ids: topo.routes.map((route) => route.routeId).filter((routeId) => !linkedRouteIds.has(routeId)),
      });
    }

    return jsonResponse({ topo }, { status: 201, headers });
  } catch (error) {
    if (error instanceof TopoValidationError) {
      return apiError("bad_request", 400, error.message, headers);
    }
    console.error("Error saving topo:", error);
    return apiError("bad_request", 400, "Failed to save topo.", headers);
  }
};
