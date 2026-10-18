import { data, type ActionFunctionArgs } from "react-router";
import { sql, type Kysely } from "kysely";
import { createUserSession } from "~/lib/auth.server";
import { getDB } from "~/lib/db";
import type { DB } from "~/lib/db.d";
import type { User } from "~/lib/models";
import { assignUserTag } from "~/lib/tags.server";

/**
 * Dev-only endpoint that provisions an e2e user with an exact role/tag state and
 * signs it in, so Playwright never drives the interactive login flow.
 *
 * Production builds do not register this route (see app/routes.ts). The runtime
 * guards below are a second line of defense: the worker must run with
 * ENVIRONMENT=dev, be reached on a loopback host, and may only touch users in the
 * reserved E2E_EMAIL_DOMAIN so real accounts copied into a local DB are never altered.
 */

export const E2E_EMAIL_DOMAIN = "e2e.test";
export const E2E_ROLES = ["anonymous", "member", "super", "admin"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface E2eSessionRequest {
  email: string;
  displayName: string;
  role: (typeof E2E_ROLES)[number];
  /** Names of existing user_tag rows. The user ends up with exactly these tags. */
  tags: string[];
  disclaimerAcknowledged: boolean;
}

function parseSessionRequest(body: unknown): E2eSessionRequest | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Request body must be a JSON object" };
  }
  const { email, displayName, role, tags = [], disclaimerAcknowledged = true } =
    body as Record<string, unknown>;

  if (typeof email !== "string" || !email.toLowerCase().endsWith(`@${E2E_EMAIL_DOMAIN}`)) {
    return { error: `email must be an address in @${E2E_EMAIL_DOMAIN}` };
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    return { error: "displayName is required" };
  }
  if (!E2E_ROLES.includes(role as E2eSessionRequest["role"])) {
    return { error: `role must be one of: ${E2E_ROLES.join(", ")}` };
  }
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
    return { error: "tags must be an array of tag names" };
  }
  if (typeof disclaimerAcknowledged !== "boolean") {
    return { error: "disclaimerAcknowledged must be a boolean" };
  }

  return {
    email: email.trim().toLowerCase(),
    displayName: displayName.trim(),
    role: role as E2eSessionRequest["role"],
    tags,
    disclaimerAcknowledged,
  };
}

async function resolveTagIds(db: Kysely<DB>, names: string[]) {
  if (names.length === 0) return { tagIds: [] as number[] };

  const rows = await db
    .selectFrom("user_tag")
    .select(["id", "name"])
    .where("name", "in", names)
    .execute();
  const missing = names.filter((name) => !rows.some((row) => row.name === name));
  if (missing.length > 0) {
    return { error: `Unknown user tags: ${missing.join(", ")}` };
  }
  return { tagIds: rows.map((row) => Number(row.id)) };
}

async function upsertE2eUser(db: Kysely<DB>, input: E2eSessionRequest): Promise<User> {
  const values = {
    display_name: input.displayName,
    role: input.role,
    email_verified: 1,
    disclaimer_ack_date: input.disclaimerAcknowledged ? new Date().toISOString() : null,
  };

  const existing = await db
    .selectFrom("user")
    .select("uid")
    .where("email", "=", input.email)
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("user").set(values).where("uid", "=", existing.uid).execute();
  } else {
    await db
      .insertInto("user")
      .values({ uid: crypto.randomUUID(), email: input.email, provider_id: "email", ...values })
      .execute();
  }

  return db
    .selectFrom("user")
    .select([
      "uid",
      "email",
      "display_name as displayName",
      sql<boolean>`email_verified = 1`.as("emailVerified"),
      "provider_id as providerId",
      "avatar_url as avatarUrl",
      "role",
      "created_at as createdAt",
      "disclaimer_ack_date as disclaimerAckDate",
    ])
    .where("email", "=", input.email)
    .executeTakeFirstOrThrow();
}

async function syncUserTags(db: Kysely<DB>, uid: string, tagIds: number[]) {
  let staleAssignments = db.deleteFrom("user_tag_assignment").where("uid", "=", uid);
  if (tagIds.length > 0) {
    staleAssignments = staleAssignments.where("tag_id", "not in", tagIds);
  }
  await staleAssignments.execute();

  for (const tagId of tagIds) {
    await assignUserTag(db, { uid, tagId });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { hostname } = new URL(request.url);
  if (context.cloudflare.env.ENVIRONMENT !== "dev" || !LOOPBACK_HOSTS.has(hostname)) {
    throw new Response("Not Found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Request body must be JSON" }, { status: 400 });
  }

  const input = parseSessionRequest(body);
  if ("error" in input) {
    return data(input, { status: 400 });
  }

  const db = getDB(context);
  const tags = await resolveTagIds(db, input.tags);
  if ("error" in tags) {
    return data({ error: tags.error }, { status: 400 });
  }

  const user = await upsertE2eUser(db, input);
  await syncUserTags(db, user.uid, tags.tagIds);

  return createUserSession(request, context, user, "/");
}
