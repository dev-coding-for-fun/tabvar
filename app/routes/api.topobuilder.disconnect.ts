import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  bearerToken,
  corsHeaders,
  hashSecret,
  jsonResponse,
} from "~/lib/topobuilderAuth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to disconnect TopoBuilder.", headers);
  }

  const token = bearerToken(request);
  if (!token) {
    return apiError("invalid_token", 401, "A bearer token is required.", headers);
  }

  const db = getDB(context);
  const tokenHash = await hashSecret(token);
  const existingToken = await db.selectFrom("api_token")
    .select(["id", "revoked_at as revokedAt"])
    .where("token_hash", "=", tokenHash)
    .where("client", "=", "topobuilder")
    .executeTakeFirst();

  if (!existingToken) {
    return apiError("invalid_token", 401, "The bearer token is invalid.", headers);
  }

  if (!existingToken.revokedAt) {
    await db.updateTable("api_token")
      .set({ revoked_at: new Date().toISOString() })
      .where("id", "=", existingToken.id)
      .execute();
  }

  return jsonResponse({ success: true }, { headers });
};
