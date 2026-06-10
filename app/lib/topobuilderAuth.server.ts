import type { AppLoadContext } from "react-router";
import { isAllowedOrigin } from "./apiAuth.server";

const TICKET_TTL_MS = 5 * 60 * 1000;

// Generic API auth helpers now live in apiAuth.server.ts. They are re-exported
// here so existing TopoBuilder routes/tests keep importing from one place.
export {
  apiError,
  bearerToken,
  corsHeaders,
  hashSecret,
  jsonResponse,
  requireApiToken,
  requireApiTokenUser,
} from "./apiAuth.server";
export type {
  ApiErrorCode,
  ApiTokenUser,
  ApiTokenUserWithRole,
} from "./apiAuth.server";

/**
 * TopoBuilder connect callbacks are validated against the same client allowlist
 * used for CORS. Kept as a named wrapper for the connect flow's call sites.
 */
export function isAllowedTopobuilderReturnTo(value: string, context: AppLoadContext) {
  return isAllowedOrigin(value, context);
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

export function ticketExpiresAt(now = Date.now()) {
  return new Date(now + TICKET_TTL_MS).toISOString();
}
