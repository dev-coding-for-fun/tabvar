import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { apiError, corsHeaders, jsonResponse, requireApiTokenUser } from "~/lib/apiAuth.server";
import { getDB } from "~/lib/db";
import { serverTimeFromUpdatedRows, toApiRoute } from "~/lib/topoSync.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  await requireApiTokenUser(request, context, headers);

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  const db = getDB(context);
  let query = db
    .selectFrom("route")
    .select([
      "id",
      "crag_id",
      "sector_id",
      "name",
      "alt_names",
      "grade_yds",
      "status",
      "latitude",
      "longitude",
      "notes",
      "sort_order",
      "bolt_count",
      "pitch_count",
      "route_length",
      "climb_style",
      "year",
      "route_built_date",
      "first_ascent_by",
      "first_ascent_date",
      "crag_name",
      "sector_name",
      "created_at",
      "updated_at",
    ]);

  if (since) {
    query = query
      .where("route.updated_at", ">=", since)
      .orderBy("route.updated_at", "asc")
      .orderBy("route.id", "asc");
  } else {
    query = query
      .orderBy("crag_id", "asc")
      .orderBy("sector_id", "asc")
      .orderBy("sort_order", "asc")
      .orderBy("name", "asc");
  }

  const rows = await query.execute();

  return jsonResponse(
    { routes: rows.map(toApiRoute), serverTime: serverTimeFromUpdatedRows(rows, since) },
    { headers },
  );
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return apiError("method_not_allowed", 405, "Use GET to pull routes.", headers);
};
