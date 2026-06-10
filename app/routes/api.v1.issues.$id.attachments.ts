import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
} from "~/lib/apiAuth.server";
import { IMAGE_TYPES } from "~/lib/constants";
import { uploadFileToR2 } from "~/lib/s3.server";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 3;
const MODERATOR_ROLES = new Set(["member", "admin", "super"]);

/**
 * POST /api/v1/issues/:id/attachments — multipart photo upload.
 *
 * Lets a client attach queued offline photos once the parent issue has a server
 * id. Anonymous tokens may only upload to issues they reported; member/admin/
 * super may upload to any issue. Same 3 photo / 5 MB / image-type limits as the
 * web issue-create flow.
 */
export const action = async ({ request, context, params }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to upload attachments.", headers);
  }

  const tokenUser = await requireApiTokenUser(request, context, headers);
  const moderator = tokenUser.role != null && MODERATOR_ROLES.has(tokenUser.role);

  const issueId = Number(params.id);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    return apiError("bad_request", 400, "A valid issue id is required.", headers);
  }

  const db = getDB(context);
  const issue = await db
    .selectFrom("issue")
    .select(["id", "reported_by_uid"])
    .where("id", "=", issueId)
    .executeTakeFirst();

  if (!issue) {
    return apiError("not_found", 404, "Issue not found.", headers);
  }

  if (!moderator && issue.reported_by_uid !== tokenUser.uid) {
    return apiError("forbidden", 403, "You may only upload attachments to issues you reported.", headers);
  }

  const formData = await request.formData();
  const files = (formData.getAll("photos") as File[]).filter((file) => file && file.size > 0);

  if (files.length === 0) {
    return apiError("bad_request", 400, "At least one photo is required.", headers);
  }
  if (files.length > MAX_FILES) {
    return apiError("bad_request", 400, `A maximum of ${MAX_FILES} photos may be uploaded.`, headers);
  }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return apiError("bad_request", 400, `${file.name} is too large. Maximum size is 5 MB.`, headers);
    }
    if (!IMAGE_TYPES.includes(file.type)) {
      return apiError("bad_request", 400, `${file.name} is not a supported image type.`, headers);
    }
  }

  const env = context.cloudflare.env as unknown as Env;
  const uploaded = await Promise.all(
    files.map((file) => uploadFileToR2(context, file, env.ISSUES_BUCKET_NAME, env.ISSUES_BUCKET_DOMAIN)),
  );

  const attachments = await Promise.all(
    uploaded.map(async (file) => {
      const result = await db
        .insertInto("issue_attachment")
        .values({
          issue_id: issueId,
          name: file.name,
          type: file.type,
          url: file.url,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id: Number(result.id), url: file.url, name: file.name, type: file.type };
    }),
  );

  return jsonResponse({ attachments }, { status: 201, headers });
};
