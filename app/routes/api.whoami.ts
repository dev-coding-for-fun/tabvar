import type { LoaderFunctionArgs } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { apiError, jsonResponse } from "~/lib/apiAuth.server";
import { getDB } from "~/lib/db";
import { getUserTags } from "~/lib/tags.server";

/**
 * GET /api/whoami — resolves the `_session` cookie to the caller's identity.
 *
 * Intended for server-to-server calls from other apps on the same domain:
 * the calling backend forwards the browser's `Cookie` header and receives
 * a minimal JSON identity. Role and tags are always read fresh from D1 so
 * admin changes take effect without requiring a re-login.
 *
 * Responses:
 *   200 { uid, email, displayName, role, tags: string[] } (active tags only)
 *   401 { error: "unauthenticated", message } when the session is missing,
 *       invalid, or the user row no longer exists.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const sessionUser = await getSessionUser(request, context);
  if (!sessionUser) {
    return apiError("unauthenticated", 401, "No valid session.");
  }

  const db = getDB(context);
  const user = await db
    .selectFrom("user")
    .select(["uid", "email", "display_name", "role"])
    .where("uid", "=", sessionUser.uid)
    .executeTakeFirst();

  if (!user) {
    return apiError("unauthenticated", 401, "No valid session.");
  }

  const tags = await getUserTags(db, user.uid);

  return jsonResponse({
    uid: user.uid,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    tags: tags.filter((tag) => !tag.isExpired).map((tag) => tag.name),
  });
}
