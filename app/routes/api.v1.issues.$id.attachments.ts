import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
} from "~/lib/apiAuth.server";
import { IMAGE_TYPES } from "~/lib/constants";
import { calculateFileHash, uploadFileToR2 } from "~/lib/s3.server";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 6;
const MODERATOR_ROLES = new Set(["member", "admin", "super"]);

/**
 * POST /api/v1/issues/:id/attachments — multipart photo upload.
 *
 * Lets a client attach queued offline photos once the parent issue has a server
 * id. Anonymous tokens may only upload to issues they reported; member/admin/
 * super may upload to any issue. Same 3 photo / 5 MB / image-type limits as the
 * web issue-create flow.
 *
 * Uses SHA-1 content hashing to guarantee idempotency on retries, prevent duplicate
 * uploads on the same issue, and share underlying R2 storage.
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

  // Deduplicate files within the incoming request batch using SHA-1 content hashes
  const uniqueUploads = new Map<string, { file: File; buffer: ArrayBuffer; hash: string }>();
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const hash = await calculateFileHash(buffer);
    if (!uniqueUploads.has(hash)) {
      uniqueUploads.set(hash, { file, buffer, hash });
    }
  }

  // Query existing attachments for this issue to check idempotency and quota
  const existingAttachments = await db
    .selectFrom("issue_attachment")
    .select(["id", "name", "url", "type", "file_hash"])
    .where("issue_id", "=", issueId)
    .execute();

  const existingByHash = new Map<string, typeof existingAttachments[number]>();
  for (const att of existingAttachments) {
    if (att.file_hash) {
      existingByHash.set(att.file_hash, att);
    }
  }

  const attachmentsToReturn: { id: number; url: string; name: string | null; type: string; hash?: string | null }[] = [];
  const filesToInsert: { file: File; buffer: ArrayBuffer; hash: string }[] = [];

  for (const item of uniqueUploads.values()) {
    const existing = existingByHash.get(item.hash);
    if (existing) {
      attachmentsToReturn.push({
        id: Number(existing.id),
        url: existing.url,
        name: existing.name,
        type: existing.type,
        hash: existing.file_hash,
      });
    } else {
      filesToInsert.push(item);
    }
  }

  if (existingAttachments.length + filesToInsert.length > MAX_FILES) {
    return apiError(
      "bad_request",
      400,
      `A maximum of ${MAX_FILES} photos may be uploaded to an issue. This issue already has ${existingAttachments.length} photos.`,
      headers,
    );
  }

  const env = context.cloudflare.env as unknown as Env;

  for (const item of filesToInsert) {
    // Check if the file was already uploaded to R2 for another issue (storage deduplication)
    const existingGlobally = await db
      .selectFrom("issue_attachment")
      .select(["url"])
      .where("file_hash", "=", item.hash)
      .limit(1)
      .executeTakeFirst();

    let fileUrl: string;
    let fileName: string;

    if (existingGlobally) {
      fileUrl = existingGlobally.url;
      fileName = item.file.name;
    } else {
      const uploaded = await uploadFileToR2(context, item.file, env.ISSUES_BUCKET_NAME, env.ISSUES_BUCKET_DOMAIN, {
        keyPrefix: "issues",
        useContentHash: true,
      });
      fileUrl = uploaded.url;
      fileName = uploaded.name;
    }

    const result = await db
      .insertInto("issue_attachment")
      .values({
        issue_id: issueId,
        name: fileName,
        type: item.file.type,
        url: fileUrl,
        file_hash: item.hash,
        file_size: item.buffer.byteLength,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    attachmentsToReturn.push({
      id: Number(result.id),
      url: fileUrl,
      name: fileName,
      type: item.file.type,
      hash: item.hash,
    });
  }

  const status = filesToInsert.length === 0 ? 200 : 201;
  return jsonResponse({ attachments: attachmentsToReturn }, { status, headers });
};
