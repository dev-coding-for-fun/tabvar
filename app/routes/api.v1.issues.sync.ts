import type { ActionFunctionArgs } from "react-router";
import { getDB } from "~/lib/db";
import {
  apiError,
  corsHeaders,
  jsonResponse,
  requireApiTokenUser,
  type ApiTokenUserWithRole,
} from "~/lib/apiAuth.server";
import {
  createIssue,
  findIssueIdByExternalRef,
  mapExternalIssueRef,
  modifyIssue,
  modifyIssueStatus,
} from "~/lib/issues.server";
import type { Issue } from "~/lib/models";

type SyncOp = "create" | "update" | "status";

type SyncMutation = {
  op?: SyncOp;
  externalId?: string;
  issueId?: number;
  baseUpdatedAt?: string;
  fields?: {
    routeId?: number;
    issueType?: string;
    subIssueType?: string | null;
    description?: string | null;
    boltsAffected?: string | null;
    status?: string;
    lastStatus?: string | null;
    isFlagged?: boolean;
    flaggedMessage?: string | null;
  };
};

const MODERATOR_ROLES = new Set(["member", "admin", "super"]);

function isModerator(role: string | null) {
  return role != null && MODERATOR_ROLES.has(role);
}

function actorFrom(tokenUser: ApiTokenUserWithRole) {
  return {
    uid: tokenUser.uid,
    displayName: tokenUser.displayName,
    role: tokenUser.role,
  };
}

async function loadServerIssue(context: ActionFunctionArgs["context"], issueId: number) {
  const db = getDB(context);
  return db.selectFrom("issue").selectAll().where("id", "=", issueId).executeTakeFirst();
}

function mapIssue(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    routeId: row.route_id,
    cragId: row.crag_id ?? null,
    issueType: row.issue_type,
    subIssueType: row.sub_issue_type ?? null,
    status: row.status,
    lastStatus: row.last_status ?? null,
    description: row.description ?? null,
    boltsAffected: row.bolts_affected ?? null,
    isFlagged: Boolean(row.is_flagged),
    flaggedMessage: row.flagged_message ?? null,
    reportedBy: row.reported_by ?? null,
    reportedByUid: row.reported_by_uid ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    lastModified: row.last_modified ?? null,
    approvedAt: row.approved_at ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

/**
 * Builds the status-change field set, mirroring the web moderation workflow
 * (approval/archival metadata) for the requested target status.
 */
function buildStatusUpdates(
  targetStatus: string,
  currentStatus: string,
  uid: string,
): Partial<Omit<Issue, "id" | "created_at">> {
  const updates: Partial<Omit<Issue, "id" | "created_at">> = {
    status: targetStatus,
    lastStatus: currentStatus,
  };
  const now = new Date().toISOString();
  if (targetStatus === "Reported" || targetStatus === "Viewed") {
    updates.approvedAt = now;
    updates.approvedByUid = uid;
  }
  if (["Completed", "Archived", "Deleted"].includes(targetStatus)) {
    updates.archivedAt = now;
    updates.archivedByUid = uid;
  }
  return updates;
}

async function readBody(request: Request): Promise<SyncMutation | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as SyncMutation) : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/v1/issues/sync — push a single issue change.
 *
 * Body: { op, externalId?, issueId?, baseUpdatedAt?, fields }
 *   - op "create": creates an issue. externalId (the client's offline UUID) maps
 *     it via external_issue_ref for idempotent retries.
 *   - op "update": edits content fields. Requires baseUpdatedAt.
 *   - op "status": transitions status (a soft delete is op "status" with
 *     status "Deleted"). Requires baseUpdatedAt.
 *
 * Conflicts are server-wins: if the server row is newer than baseUpdatedAt the
 * change is rejected with 409 and the current server issue.
 *
 * Permissions: anonymous tokens may only create issues in "In Moderation";
 * member/admin/super get full create/update/status.
 */
export const action = async ({ request, context }: ActionFunctionArgs) => {
  const headers = corsHeaders(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return apiError("method_not_allowed", 405, "Use POST to sync an issue.", headers);
  }

  const tokenUser = await requireApiTokenUser(request, context, headers);
  const moderator = isModerator(tokenUser.role);

  const body = await readBody(request);
  if (!body?.op) {
    return apiError("bad_request", 400, "op is required (create, update, or status).", headers);
  }

  const fields = body.fields ?? {};

  if (body.op === "create") {
    if (typeof fields.routeId !== "number" || !fields.issueType) {
      return apiError("bad_request", 400, "create requires fields.routeId and fields.issueType.", headers);
    }

    // Non-moderators (anonymous) may only file new issues for moderation.
    const requestedStatus = fields.status ?? "In Moderation";
    if (!moderator && requestedStatus !== "In Moderation") {
      return apiError("forbidden", 403, "You may only create issues in 'In Moderation'.", headers);
    }
    const status = moderator ? requestedStatus : "In Moderation";

    // Idempotent retry: an existing mapping resolves to the prior issue.
    if (body.externalId) {
      const existingId = await findIssueIdByExternalRef(context, tokenUser.client, body.externalId);
      if (existingId) {
        const existing = await loadServerIssue(context, existingId);
        return jsonResponse(
          { status: "applied", serverId: existingId, issue: existing ? mapIssue(existing) : null },
          { headers },
        );
      }
    }

    const newId = await createIssue(context, {
      routeId: fields.routeId,
      issueType: fields.issueType,
      subIssueType: fields.subIssueType ?? null,
      description: fields.description ?? null,
      boltsAffected: fields.boltsAffected ?? null,
      status,
      reportedBy: tokenUser.displayName,
      reportedByUid: tokenUser.uid,
    });

    if (body.externalId) {
      await mapExternalIssueRef(context, tokenUser.client, body.externalId, newId);
    }

    const created = await loadServerIssue(context, newId);
    return jsonResponse(
      { status: "applied", serverId: newId, issue: created ? mapIssue(created) : null },
      { status: 201, headers },
    );
  }

  // update / status both target an existing issue.
  if (!moderator) {
    return apiError("forbidden", 403, "Member access is required to modify issues.", headers);
  }

  if (typeof body.issueId !== "number") {
    return apiError("bad_request", 400, "issueId is required for update and status.", headers);
  }
  if (!body.baseUpdatedAt) {
    return apiError("bad_request", 400, "baseUpdatedAt is required for update and status.", headers);
  }

  const serverIssue = await loadServerIssue(context, body.issueId);
  if (!serverIssue) {
    return apiError("not_found", 404, "Issue not found.", headers);
  }

  // Server wins: reject if the server row changed since the client's base.
  if (serverIssue.updated_at && serverIssue.updated_at > body.baseUpdatedAt) {
    return jsonResponse(
      { status: "conflict", serverId: body.issueId, issue: mapIssue(serverIssue) },
      { status: 409, headers },
    );
  }

  if (body.op === "status") {
    if (!fields.status) {
      return apiError("bad_request", 400, "fields.status is required for a status change.", headers);
    }
    await modifyIssueStatus(
      context,
      body.issueId,
      buildStatusUpdates(fields.status, serverIssue.status, tokenUser.uid),
      actorFrom(tokenUser),
      tokenUser.client,
    );
  } else {
    await modifyIssue(
      context,
      body.issueId,
      {
        issueType: fields.issueType ?? serverIssue.issue_type,
        subIssueType: fields.subIssueType ?? serverIssue.sub_issue_type,
        description: fields.description ?? serverIssue.description,
        boltsAffected: fields.boltsAffected ?? serverIssue.bolts_affected,
        isFlagged: fields.isFlagged ?? Boolean(serverIssue.is_flagged),
        flaggedMessage: fields.flaggedMessage ?? serverIssue.flagged_message,
      },
      actorFrom(tokenUser),
      tokenUser.client,
    );
  }

  const updated = await loadServerIssue(context, body.issueId);
  return jsonResponse(
    { status: "applied", serverId: body.issueId, issue: updated ? mapIssue(updated) : null },
    { headers },
  );
};
