import type { AppLoadContext } from "react-router";
import { getDB } from "./db";
import { deleteFromR2 } from "./s3.server";
import type { Issue, User } from "./models";

/**
 * Shared issue mutation helpers used by both the web moderation UI
 * (issues.manage / issues.create) and the client sync API (/api/v1/issues).
 *
 * `source` identifies the origin of the change ("web" or an API client name
 * such as "topobuilder"). It is accepted for future auditing/telemetry; the
 * current issue_audit_log schema has no source column so it is not persisted.
 */
export type IssueMutationSource = "web" | (string & {});

/**
 * Wire-format issue DTO shared by the /api/v1/issues endpoints (delta pull and
 * sync push). Deliberately distinct from the domain `Issue` in models.ts: this
 * is a versioned external contract, so changes to it should be intentional.
 */
export type ApiIssue = {
  id: number;
  routeId: number;
  cragId: number | null;
  issueType: string;
  subIssueType: string | null;
  status: string;
  lastStatus: string | null;
  description: string | null;
  boltsAffected: string | null;
  isFlagged: boolean;
  flaggedMessage: string | null;
  reportedBy: string | null;
  reportedByUid: string | null;
  createdAt: string;
  updatedAt: string | null;
  lastModified: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
};

type IssueRowForApi = {
  id: number | bigint;
  route_id: number;
  crag_id: number | null;
  issue_type: string;
  sub_issue_type: string | null;
  status: string;
  last_status: string | null;
  description: string | null;
  bolts_affected: string | null;
  is_flagged: number | null;
  flagged_message: string | null;
  reported_by: string | null;
  reported_by_uid: string | null;
  created_at: string;
  updated_at: string | null;
  last_modified: string | null;
  approved_at: string | null;
  archived_at: string | null;
};

/** Maps a DB `issue` row (snake_case) to the wire-format ApiIssue. */
export function toApiIssue(row: IssueRowForApi): ApiIssue {
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

type IssueActor = Pick<User, "uid" | "displayName" | "role">;

export async function createIssue(
  context: AppLoadContext,
  params: {
    routeId: number;
    issueType: string;
    subIssueType?: string | null;
    description?: string | null;
    boltsAffected?: string | null;
    status?: string;
    reportedBy?: string | null;
    reportedByUid?: string | null;
  },
): Promise<number> {
  const db = getDB(context);
  const result = await db
    .insertInto("issue")
    .values({
      route_id: params.routeId,
      issue_type: params.issueType,
      sub_issue_type: params.subIssueType ?? null,
      description: params.description ?? null,
      bolts_affected: params.boltsAffected || null,
      status: params.status ?? "In Moderation",
      reported_by_uid: params.reportedByUid ?? null,
      reported_by: params.reportedBy ?? null,
      last_modified: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return Number(result.id);
}

/**
 * Resolves the local issue id for a client's external reference, if one exists.
 */
export async function findIssueIdByExternalRef(
  context: AppLoadContext,
  source: string,
  externalId: string,
): Promise<number | null> {
  const db = getDB(context);
  const row = await db
    .selectFrom("external_issue_ref")
    .select(["local_id"])
    .where("external_id", "=", externalId)
    .where("source", "=", source)
    .executeTakeFirst();
  return row?.local_id ?? null;
}

/**
 * Records the mapping between a client's external id and a local issue id.
 */
export async function mapExternalIssueRef(
  context: AppLoadContext,
  source: string,
  externalId: string,
  localId: number,
): Promise<void> {
  const db = getDB(context);
  await db
    .insertInto("external_issue_ref")
    .values({
      local_id: localId,
      external_id: externalId,
      source,
    })
    .execute();
}

export async function modifyIssue(
  context: AppLoadContext,
  issueId: number,
  updates: Partial<Issue>,
  user: IssueActor,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _source: IssueMutationSource = "web",
) {
  const db = getDB(context);
  const issue = await db.selectFrom('issue').selectAll()
    .where('id', '=', issueId).executeTakeFirstOrThrow();

  const issueUpdates: Record<string, unknown> = {
    last_modified: new Date().toISOString(),
  };

  if (updates.issueType !== undefined) issueUpdates.issue_type = updates.issueType;
  if (updates.subIssueType !== undefined) issueUpdates.sub_issue_type = updates.subIssueType;
  if (updates.description !== undefined) issueUpdates.description = updates.description;
  if (updates.isFlagged !== undefined) issueUpdates.is_flagged = updates.isFlagged ? 1 : 0;
  if (updates.flaggedMessage !== undefined) issueUpdates.flagged_message = updates.flaggedMessage;
  if (updates.boltsAffected !== undefined) issueUpdates.bolts_affected = updates.boltsAffected;

  if (updates.status !== undefined) {
    issueUpdates.status = updates.status;
    if (updates.lastStatus !== undefined) issueUpdates.last_status = updates.lastStatus;
    if (updates.approvedAt !== undefined) issueUpdates.approved_at = updates.approvedAt;
    if (updates.approvedByUid !== undefined) issueUpdates.approved_by_uid = updates.approvedByUid;
    if (updates.archivedAt !== undefined) issueUpdates.archived_at = updates.archivedAt;
    if (updates.archivedByUid !== undefined) issueUpdates.archived_by_uid = updates.archivedByUid;
  }

  await db.updateTable('issue')
    .set(issueUpdates as any)
    .where('id', '=', issueId)
    .execute();

  const auditLogValues: Record<string, unknown> = {
    issue_id: issueId,
    action: "update",
    uid: user.uid,
    user_display_name: user.displayName,
    user_role: user.role,
  };

  if (updates.issueType !== undefined) {
    auditLogValues.before_issue_type = issue.issue_type;
    auditLogValues.after_issue_type = updates.issueType;
  }
  if (updates.subIssueType !== undefined) {
    auditLogValues.before_sub_issue_type = issue.sub_issue_type;
    auditLogValues.after_sub_issue_type = updates.subIssueType;
  }
  if (updates.description !== undefined) {
    auditLogValues.before_description = issue.description;
    auditLogValues.after_description = updates.description;
  }
  if (updates.isFlagged !== undefined) {
    auditLogValues.before_is_flagged = issue.is_flagged;
    auditLogValues.after_is_flagged = updates.isFlagged ? 1 : 0;
  }
  if (updates.flaggedMessage !== undefined) {
    auditLogValues.before_flagged_message = issue.flagged_message;
    auditLogValues.after_flagged_message = updates.flaggedMessage;
  }
  if (updates.boltsAffected !== undefined) {
    auditLogValues.before_bolts_affected = issue.bolts_affected;
    auditLogValues.after_bolts_affected = updates.boltsAffected;
  }
  if (updates.status !== undefined) {
    auditLogValues.before_status = issue.status;
    auditLogValues.after_status = updates.status;
  }

  await db.insertInto('issue_audit_log')
    .values(auditLogValues as any)
    .execute();
}

export async function modifyIssueStatus(
  context: AppLoadContext,
  issueId: number,
  updates: Partial<Omit<Issue, "id" | "created_at">>,
  user: IssueActor,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _source: IssueMutationSource = "web",
) {
  return modifyIssue(context, issueId, updates, user, _source);
}

/**
 * Hard delete (web admin only): removes the issue row, its attachments (and R2
 * files), and external refs. Sync clients use the "Deleted" status soft-delete
 * via modifyIssueStatus instead.
 */
export async function deleteIssue(context: AppLoadContext, issueId: number, user: IssueActor) {
  const db = getDB(context);
  const env = context.cloudflare.env as unknown as Env;
  const issue = await db.selectFrom('issue').selectAll()
    .where('id', '=', issueId).executeTakeFirstOrThrow();
  const attachments = await db.selectFrom('issue_attachment')
    .select(['url', 'name'])
    .where('issue_id', '=', issueId).execute();
  if (attachments.length > 0) {
    for (const attachment of attachments) {
      // Only delete from R2 if no other issue references the same URL
      const otherRef = await db
        .selectFrom('issue_attachment')
        .where('url', '=', attachment.url)
        .where('issue_id', '!=', issueId)
        .select('id')
        .limit(1)
        .executeTakeFirst();

      if (!otherRef) {
        const fileName = attachment.name ?? attachment.url.split('/').pop();
        if (!fileName) { throw new Error('Invalid attachment filename'); }
        await deleteFromR2(context, env.ISSUES_BUCKET_NAME, fileName);
      }
    }
  }
  await db.deleteFrom('issue_attachment')
    .where('issue_attachment.issue_id', '=', issueId)
    .execute();
  await db.deleteFrom('external_issue_ref')
    .where('external_issue_ref.local_id', '=', issueId)
    .execute();
  await db.deleteFrom('issue')
    .where('issue.id', '=', issueId)
    .execute();
  await db.insertInto('issue_audit_log')
    .values({
      issue_id: issueId,
      action: "delete",
      uid: user.uid,
      user_display_name: user.displayName,
      user_role: user.role,
      before_bolts_affected: issue.bolts_affected,
      before_description: issue.description,
      before_is_flagged: issue.is_flagged,
      before_flagged_message: issue.flagged_message,
      before_issue_type: issue.issue_type,
      before_route_id: issue.route_id,
      before_status: issue.status,
      before_sub_issue_type: issue.sub_issue_type,
    })
    .execute();
}
