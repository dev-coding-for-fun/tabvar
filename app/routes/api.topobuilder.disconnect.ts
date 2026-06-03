import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiToken,
} from "~/lib/topobuilderAuth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to disconnect TopoBuilder.", headers);
  }

  const db = getDB(context);
  const existingToken = await requireApiToken(request, context, headers);

  await db.updateTable("api_token")
    .set({ revoked_at: new Date().toISOString() })
    .where("id", "=", existingToken.tokenId)
    .execute();

  return jsonResponse({ success: true }, { headers });
};
