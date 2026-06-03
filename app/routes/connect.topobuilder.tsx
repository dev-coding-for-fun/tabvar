import { data, redirect, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { getDB } from "~/lib/db";
import { requireUser } from "~/lib/auth.server";
import {
  addQueryParam,
  generateSecret,
  hashSecret,
  isAllowedTopobuilderReturnTo,
  ticketExpiresAt,
} from "~/lib/topobuilderAuth.server";
import { privatePageMeta } from "~/lib/seo";

export const meta: MetaFunction = () => privatePageMeta("Connect TopoBuilder");

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return_to");

  if (!returnTo || !isAllowedTopobuilderReturnTo(returnTo, context)) {
    return data("Invalid TopoBuilder callback URL.", { status: 400 });
  }

  const user = await requireUser(request, context);
  const ticket = generateSecret("tb_ticket");
  const ticketHash = await hashSecret(ticket);
  const db = getDB(context);

  await db.insertInto("topobuilder_connect_ticket")
    .values({
      id: crypto.randomUUID(),
      uid: user.uid,
      ticket_hash: ticketHash,
      return_to: returnTo,
      expires_at: ticketExpiresAt(),
    })
    .execute();

  throw redirect(addQueryParam(returnTo, "ticket", ticket));
};

export default function ConnectTopobuilder() {
  return null;
}
