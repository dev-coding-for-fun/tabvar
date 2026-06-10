import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
} from "~/lib/apiAuth.server";
import { toApiIssue, type ApiIssue } from "~/lib/issues.server";

type SyncAttachment = {
  id: number;
  url: string;
  name: string | null;
  type: string;
};

type SyncIssue = ApiIssue & {
  attachments: SyncAttachment[];
};

// SQLite CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS", UTC) so the cursor we
// hand back is directly comparable to issue.updated_at.
function formatSqliteTimestamp(date = new Date()) {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/**
 * GET /api/v1/issues — delta pull.
 *
 * Query params:
 *   since: optional ISO/SQLite timestamp cursor. Returns issues with
 *          updated_at >= since (inclusive so boundary rows are never skipped;
 *          clients dedupe/upsert by id). Soft-deleted issues (status "Deleted")
 *          are included so clients can remove them locally.
 * Response: { issues, serverTime }. Pass serverTime back as `since` next time.
 */
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const headers = corsHeaders(request, context);
  await requireApiTokenUser(request, context, headers);

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  const db = getDB(context);
  let query = db
    .selectFrom("issue")
    .leftJoin("issue_attachment", "issue_attachment.issue_id", "issue.id")
    .select([
      "issue.id as id",
      "issue.route_id as route_id",
      "issue.crag_id as crag_id",
      "issue.issue_type as issue_type",
      "issue.sub_issue_type as sub_issue_type",
      "issue.status as status",
      "issue.last_status as last_status",
      "issue.description as description",
      "issue.bolts_affected as bolts_affected",
      "issue.is_flagged as is_flagged",
      "issue.flagged_message as flagged_message",
      "issue.reported_by as reported_by",
      "issue.reported_by_uid as reported_by_uid",
      "issue.created_at as created_at",
      "issue.updated_at as updated_at",
      "issue.last_modified as last_modified",
      "issue.approved_at as approved_at",
      "issue.archived_at as archived_at",
      "issue_attachment.id as attachment_id",
      "issue_attachment.url as attachment_url",
      "issue_attachment.name as attachment_name",
      "issue_attachment.type as attachment_type",
    ])
    .orderBy("issue.updated_at", "asc");

  if (since) {
    query = query.where("issue.updated_at", ">=", since);
  }

  const rows = await query.execute();

  const issuesMap = new Map<number, SyncIssue>();
  let maxUpdatedAt: string | null = null;

  for (const row of rows) {
    const issueId = Number(row.id);
    if (!issuesMap.has(issueId)) {
      issuesMap.set(issueId, { ...toApiIssue(row), attachments: [] });
    }

    if (row.updated_at && (!maxUpdatedAt || row.updated_at > maxUpdatedAt)) {
      maxUpdatedAt = row.updated_at;
    }

    if (row.attachment_id && row.attachment_url) {
      issuesMap.get(issueId)!.attachments.push({
        id: row.attachment_id,
        url: row.attachment_url,
        name: row.attachment_name ?? null,
        type: row.attachment_type ?? "",
      });
    }
  }

  const serverTime = maxUpdatedAt ?? since ?? formatSqliteTimestamp();

  return jsonResponse({ issues: Array.from(issuesMap.values()), serverTime }, { headers });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return apiError("method_not_allowed", 405, "Use GET to pull issues.", headers);
};
