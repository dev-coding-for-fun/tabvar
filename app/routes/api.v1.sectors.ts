import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { apiError, corsHeaders, jsonResponse, requireApiTokenUser } from "~/lib/apiAuth.server";
import { getDB } from "~/lib/db";
import { serverTimeFromUpdatedRows, toApiSector } from "~/lib/topoSync.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  await requireApiTokenUser(request, context, headers);

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  const db = getDB(context);
  let query = db
    .selectFrom("sector")
    .select([
      "id",
      "crag_id",
      "name",
      "latitude",
      "longitude",
      "notes",
      "sort_order",
      "created_at",
      "updated_at",
    ]);

  if (since) {
    query = query
      .where("sector.updated_at", ">=", since)
      .orderBy("sector.updated_at", "asc")
      .orderBy("sector.id", "asc");
  } else {
    query = query
      .orderBy("crag_id", "asc")
      .orderBy("sort_order", "asc")
      .orderBy("name", "asc");
  }

  const rows = await query.execute();

  return jsonResponse(
    { sectors: rows.map(toApiSector), serverTime: serverTimeFromUpdatedRows(rows, since) },
    { headers },
  );
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return apiError("method_not_allowed", 405, "Use GET to pull sectors.", headers);
};
