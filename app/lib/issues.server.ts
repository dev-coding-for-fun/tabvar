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
  await db.updateTable('issue')
    .set({
      issue_type: updates.issueType,
      sub_issue_type: updates.subIssueType,
      description: updates.description,
      is_flagged: updates.isFlagged ? 1 : 0,
      flagged_message: updates.flaggedMessage,
      bolts_affected: updates.boltsAffected,
      last_modified: new Date().toISOString(),
    })
    .where('id', '=', issueId)
    .execute();
  await db.insertInto('issue_audit_log')
    .values({
      issue_id: issueId,
      action: "update",
      uid: user.uid,
      user_display_name: user.displayName,
      user_role: user.role,
      before_issue_type: issue.issue_type,
      after_issue_type: updates.issueType,
      before_sub_issue_type: issue.sub_issue_type,
      after_sub_issue_type: updates.subIssueType,
      before_description: issue.description,
      after_description: updates.description,
      before_is_flagged: issue.is_flagged,
      after_is_flagged: updates.isFlagged ? 1 : 0,
      before_flagged_message: issue.flagged_message,
      after_flagged_message: updates.flaggedMessage,
      before_bolts_affected: issue.bolts_affected,
      after_bolts_affected: updates.boltsAffected,
    })
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
  const db = getDB(context);
  // Fetch the current issue state *before* updating for the audit log
  const issue = await db.selectFrom('issue').selectAll()
    .where('id', '=', issueId).executeTakeFirstOrThrow();

  await db.updateTable('issue')
    .set({
      status: updates.status,
      last_status: updates.lastStatus,
      approved_at: updates.approvedAt,
      approved_by_uid: updates.approvedByUid,
      archived_at: updates.archivedAt,
      archived_by_uid: updates.archivedByUid,
      last_modified: new Date().toISOString(),
    })
    .where('id', '=', issueId)
    .execute();

  await db.insertInto('issue_audit_log')
    .values({
      issue_id: issueId,
      action: "update",
      uid: user.uid,
      user_display_name: user.displayName,
      user_role: user.role,
      before_status: issue.status,
      after_status: updates.status,
    }).execute();
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
      const fileName = attachment.name ?? attachment.url.split('/').pop();
      if (!fileName) { throw new Error('Invalid attachment filename'); }
      await deleteFromR2(context, env.ISSUES_BUCKET_NAME, fileName);
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
