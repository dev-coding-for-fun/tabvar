import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { apiError, corsHeaders, jsonResponse, requireApiTokenUser } from "~/lib/apiAuth.server";
import { getDB } from "~/lib/db";
import { serverTimeFromUpdatedRows, toApiCrag } from "~/lib/topoSync.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  await requireApiTokenUser(request, context, headers);

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  const db = getDB(context);
  let query = db
    .selectFrom("crag")
    .select([
      "id",
      "name",
      "slug",
      "latitude",
      "longitude",
      "notes",
      "stats_active_issue_count",
      "stats_issue_flagged",
      "stats_public_issue_count",
      "created_at",
      "updated_at",
    ]);

  if (since) {
    query = query
      .where("crag.updated_at", ">=", since)
      .orderBy("crag.updated_at", "asc")
      .orderBy("crag.id", "asc");
  } else {
    query = query.orderBy("name", "asc");
  }

  const rows = await query.execute();

  return jsonResponse(
    { crags: rows.map(toApiCrag), serverTime: serverTimeFromUpdatedRows(rows, since) },
    { headers },
  );
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return apiError("method_not_allowed", 405, "Use GET to pull crags.", headers);
};
