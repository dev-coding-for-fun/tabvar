import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  generateSecret,
  hashSecret,
  jsonResponse,
} from "~/lib/topobuilderAuth.server";

type CompleteConnectBody = {
  ticket?: string;
};

async function readBody(request: Request): Promise<CompleteConnectBody | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as CompleteConnectBody : null;
  } catch {
    return null;
  }
}

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to complete a TopoBuilder connection.", headers);
  }

  const body = await readBody(request);
  if (!body?.ticket) {
    return apiError("bad_request", 400, "ticket is required.", headers);
  }

  const db = getDB(context);
  const now = new Date().toISOString();
  const ticketHash = await hashSecret(body.ticket);
  const ticket = await db.selectFrom("topobuilder_connect_ticket")
    .innerJoin("user", "topobuilder_connect_ticket.uid", "user.uid")
    .select([
      "topobuilder_connect_ticket.id as ticketId",
      "topobuilder_connect_ticket.uid as uid",
      "user.display_name as displayName",
      "user.email as email",
      "user.role as role",
    ])
    .where("topobuilder_connect_ticket.ticket_hash", "=", ticketHash)
    .where("topobuilder_connect_ticket.used_at", "is", null)
    .where("topobuilder_connect_ticket.expires_at", ">", now)
    .executeTakeFirst();

  if (!ticket) {
    return apiError("invalid_ticket", 401, "The TopoBuilder connection ticket is invalid or expired.", headers);
  }

  await db.updateTable("topobuilder_connect_ticket")
    .set({ used_at: now })
    .where("id", "=", ticket.ticketId)
    .execute();

  const token = generateSecret("tb_token");
  await db.insertInto("api_token")
    .values({
      id: crypto.randomUUID(),
      uid: ticket.uid,
      client: "topobuilder",
      name: "TopoBuilder",
      token_hash: await hashSecret(token),
    })
    .execute();

  return jsonResponse({
    token,
    user: {
      uid: ticket.uid,
      displayName: ticket.displayName,
      email: ticket.email,
      role: ticket.role,
    },
  }, { headers });
};
