import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
} from "~/lib/apiAuth.server";
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
  const id = url.searchParams.get("id");
  const since = url.searchParams.get("since");
  const sectorId = url.searchParams.get("sectorId");
  const cragId = url.searchParams.get("cragId");

  if (id) {
    const topo = await loadTopoById(context, id);
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
    const id = url.searchParams.get("id");
    if (!id) {
      return apiError("bad_request", 400, "Topo id is required for deletion.", headers);
    }
    const success = await deleteTopo(context, id);
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

    const topo = await saveRawTopo(context, {
      uid: tokenUser.uid,
      backgroundFile,
      rasterFile,
      payload: parsedPayload,
    });

    return jsonResponse({ topo }, { status: 201, headers });
  } catch (error) {
    if (error instanceof TopoValidationError) {
      return apiError("bad_request", 400, error.message, headers);
    }
    console.error("Error saving topo:", error);
    return apiError("bad_request", 400, "Failed to save topo.", headers);
  }
};
