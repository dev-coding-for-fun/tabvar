import type { AppLoadContext } from "react-router";
import { getDB } from "./db";

const DEFAULT_ORIGIN_ALLOWLIST = ["topobuilder:"];
const DEV_ORIGIN_ALLOWLIST = [
  "exp:",
  "http://localhost:8081",
  "http://localhost:19006",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
];

type ApiAuthEnv = {
  ENVIRONMENT?: string;
  TOPOBUILDER_RETURN_TO_ALLOWLIST?: string;
};

export type ApiErrorCode =
  | "bad_request"
  | "invalid_submission"
  | "invalid_return_to"
  | "invalid_ticket"
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "method_not_allowed";

export type ApiTokenUser = {
  tokenId: string;
  uid: string;
  client: string;
};

export type ApiTokenUserWithRole = ApiTokenUser & {
  role: string | null;
  displayName: string | null;
};

function getEnv(context: AppLoadContext): ApiAuthEnv {
  return context.cloudflare.env as unknown as ApiAuthEnv;
}

function configuredAllowlist(context: AppLoadContext) {
  const env = getEnv(context);
  const configured = env.TOPOBUILDER_RETURN_TO_ALLOWLIST
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  const defaults = env.ENVIRONMENT === "production"
    ? DEFAULT_ORIGIN_ALLOWLIST
    : [...DEFAULT_ORIGIN_ALLOWLIST, ...DEV_ORIGIN_ALLOWLIST];

  return [...defaults, ...configured];
}

function urlMatchesEntry(url: URL, value: string, entry: string) {
  if (entry.endsWith(":")) {
    return url.protocol === entry;
  }

  if (entry.endsWith("://")) {
    return value.startsWith(entry);
  }

  try {
    return url.origin === new URL(entry).origin;
  } catch {
    return false;
  }
}

/**
 * Checks a value (URL string) against the configured client allowlist. Shared by
 * the connect-flow return_to validation and the API CORS origin check so that any
 * client we trust to link is also trusted as a CORS origin.
 */
export function isAllowedOrigin(value: string, context: AppLoadContext) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return configuredAllowlist(context).some((entry) => urlMatchesEntry(url, value, entry));
}

export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function apiError(code: ApiErrorCode, status: number, message: string, headers?: HeadersInit) {
  return jsonResponse({ error: code, message }, { status, headers });
}

export function bearerToken(request: Request) {
  const header = request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * Validates a bearer token against the api_token table. Client-agnostic: any
 * non-revoked, unexpired token is accepted and its `client` is returned for
 * audit/scoping. Pass `client` to restrict to a single client.
 */
export async function requireApiToken(
  request: Request,
  context: AppLoadContext,
  headers?: HeadersInit,
  client?: string,
): Promise<ApiTokenUser> {
  const token = bearerToken(request);
  if (!token) {
    throw apiError("invalid_token", 401, "A bearer token is required.", headers);
  }

  const db = getDB(context);
  const now = new Date().toISOString();
  const tokenHash = await hashSecret(token);
  let query = db.selectFrom("api_token")
    .select(["id", "uid", "client"])
    .where("token_hash", "=", tokenHash)
    .where("revoked_at", "is", null)
    .where((eb) => eb.or([
      eb("expires_at", "is", null),
      eb("expires_at", ">", now),
    ]));

  if (client) {
    query = query.where("client", "=", client);
  }

  const existingToken = await query.executeTakeFirst();

  if (!existingToken) {
    throw apiError("invalid_token", 401, "The bearer token is invalid.", headers);
  }

  await db.updateTable("api_token")
    .set({ last_used_at: now })
    .where("id", "=", existingToken.id)
    .execute();

  return {
    tokenId: existingToken.id,
    uid: existingToken.uid,
    client: existingToken.client,
  };
}

/**
 * Like requireApiToken, but also resolves the linked user's role/display name so
 * endpoints can apply the same permission gates as the web app.
 */
export async function requireApiTokenUser(
  request: Request,
  context: AppLoadContext,
  headers?: HeadersInit,
  client?: string,
): Promise<ApiTokenUserWithRole> {
  const tokenUser = await requireApiToken(request, context, headers, client);
  const db = getDB(context);
  const user = await db.selectFrom("user")
    .select(["role", "display_name"])
    .where("uid", "=", tokenUser.uid)
    .executeTakeFirst();

  return {
    ...tokenUser,
    role: user?.role ?? null,
    displayName: user?.display_name ?? null,
  };
}

export function corsHeaders(request: Request, context: AppLoadContext) {
  const headers = new Headers();
  const origin = request.headers.get("Origin");

  if (origin && isAllowedOrigin(origin, context)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return headers;
}
