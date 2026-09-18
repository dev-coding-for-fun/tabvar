import type { LoaderFunctionArgs } from "react-router";
import { getAuthenticator } from "~/lib/auth.server";
import { getDB } from "~/lib/db";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const filename = params.filename;
  if (!filename) {
    throw new Response("Filename is required", { status: 400 });
  }

  // 1. Ensure user is authenticated
  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  // 2. Authorize access: must be admin or the assigned owner of this code
  if (user.role !== "admin") {
    const db = getDB(context);
    const code = await db
      .selectFrom("user_discount_code")
      .select(["claimed_email as claimedEmail", "claimed_uid as claimedUid"])
      .where("code_key", "=", filename)
      .executeTakeFirst();

    const userEmail = user.email?.trim().toLowerCase();
    const isOwner = code && ((userEmail && code.claimedEmail === userEmail) || code.claimedUid === user.uid);

    if (!isOwner) {
      throw new Response("Forbidden", { status: 403 });
    }
  }

  // 3. Fetch from R2 TABVAR_MISC bucket
  const env = context.cloudflare.env;
  const bucket = env.TABVAR_MISC;
  if (!bucket) {
    throw new Response("Storage bucket not configured", { status: 500 });
  }

  const object = await bucket.get(filename);
  if (!object) {
    throw new Response("Image not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  // Guarantee Content-Type based on extension if not in R2 metadata
  if (!headers.has("content-type")) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "svg") {
      headers.set("content-type", "image/svg+xml");
    } else if (ext === "jpg" || ext === "jpeg") {
      headers.set("content-type", "image/jpeg");
    } else if (ext === "webp") {
      headers.set("content-type", "image/webp");
    } else {
      headers.set("content-type", "image/png");
    }
  }

  // Handle download vs inline display
  const url = new URL(request.url);
  const isDownload = url.searchParams.has("download");
  const requestedFilename = url.searchParams.get("filename") || filename;

  if (isDownload) {
    headers.set("content-disposition", `attachment; filename="${requestedFilename}"`);
  } else if (!headers.has("content-disposition")) {
    headers.set("content-disposition", `inline; filename="${filename}"`);
  }

  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=86400");

  return new Response(object.body, { headers });
}
