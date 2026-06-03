import type { AppLoadContext } from "react-router";

const TICKET_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RETURN_TO_ALLOWLIST = ["topobuilder:"];
const DEV_RETURN_TO_ALLOWLIST = [
  "exp:",
  "http://localhost:8081",
  "http://localhost:19006",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
];

type TopobuilderEnv = {
  ENVIRONMENT?: string;
  TOPOBUILDER_RETURN_TO_ALLOWLIST?: string;
};

export type ApiErrorCode =
  | "bad_request"
  | "invalid_return_to"
  | "invalid_ticket"
  | "invalid_token"
  | "method_not_allowed";

function getEnv(context: AppLoadContext): TopobuilderEnv {
  return context.cloudflare.env as unknown as TopobuilderEnv;
}

function configuredAllowlist(context: AppLoadContext) {
  const env = getEnv(context);
  const configured = env.TOPOBUILDER_RETURN_TO_ALLOWLIST
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  const defaults = env.ENVIRONMENT === "production"
    ? DEFAULT_RETURN_TO_ALLOWLIST
    : [...DEFAULT_RETURN_TO_ALLOWLIST, ...DEV_RETURN_TO_ALLOWLIST];

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

export function isAllowedTopobuilderReturnTo(value: string, context: AppLoadContext) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return configuredAllowlist(context).some((entry) => urlMatchesEntry(url, value, entry));
}

export function addQueryParam(url: string, key: string, value: string) {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateSecret(prefix: "tb_ticket" | "tb_token") {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64Url(bytes)}`;
}

export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function ticketExpiresAt(now = Date.now()) {
  return new Date(now + TICKET_TTL_MS).toISOString();
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

export function corsHeaders(request: Request, context: AppLoadContext) {
  const headers = new Headers();
  const origin = request.headers.get("Origin");

  if (origin && isAllowedTopobuilderReturnTo(origin, context)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return headers;
}
