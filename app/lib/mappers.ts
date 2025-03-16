import type { DB } from './db.d';
import * as Models from './models';

export function mapSectorFromDb(dbSector: DB['sector']): Models.Sector {
    return {
      id: dbSector.id as unknown as number,
      name: dbSector.name,
      cragId: dbSector.crag_id ?? undefined,
      latitude: dbSector.latitude ?? undefined,
      longitude: dbSector.longitude ?? undefined,
      sortOrder: dbSector.sort_order ?? undefined,
      createdAt: dbSector.created_at as unknown as string ?? undefined,
    };
  }
  
export function mapCragFromDb(dbCrag: DB['crag']): Models.Crag {
  return {
    id: dbCrag.id as unknown as number,
    name: dbCrag.name,
    latitude: dbCrag.latitude ?? undefined,
    longitude: dbCrag.longitude ?? undefined,
    hasSectors: Boolean(dbCrag.has_sectors),
    createdAt: dbCrag.created_at as unknown as string ?? undefined,
    statsActiveIssueCount: dbCrag.stats_active_issue_count ?? undefined,
    statsIssueFlagged: dbCrag.stats_issue_flagged ?? undefined,
    statsPublicIssueCount: dbCrag.stats_public_issue_count ?? undefined,
  };
}

export function mapRouteFromDb(dbRoute: DB['route']): Models.Route {
    return {
      id: dbRoute.id as unknown as number,
      name: dbRoute.name,
      sectorId: dbRoute.sector_id ?? undefined,
      sectorName: dbRoute.sector_name ?? undefined,
      cragName: dbRoute.crag_name ?? undefined,
      altNames: dbRoute.alt_names ?? undefined,
      boltCount: dbRoute.bolt_count ?? undefined,
      climbStyle: dbRoute.climb_style ?? undefined,
      firstAscentBy: dbRoute.first_ascent_by ?? undefined,
      firstAscentDate: dbRoute.first_ascent_date ?? undefined,
      gradeYds: dbRoute.grade_yds ?? undefined,
      latitude: dbRoute.latitude ?? undefined,
      longitude: dbRoute.longitude ?? undefined,
      pitchCount: dbRoute.pitch_count ?? undefined,
      routeBuiltDate: dbRoute.route_built_date ?? undefined,
      routeLength: dbRoute.route_length ?? undefined,
      sortOrder: dbRoute.sort_order ?? undefined,
      status: dbRoute.status ?? undefined,
      createdAt: dbRoute.created_at as unknown as string ?? undefined,
    };
  }
  
  export function mapIssueFromDb(dbIssue: DB['issue']): Models.Issue {
    return {
      id: dbIssue.id as unknown as number,
      routeId: dbIssue.route_id,
      issueType: dbIssue.issue_type,
      subIssueType: dbIssue.sub_issue_type ?? undefined,
      status: dbIssue.status,
      description: dbIssue.description ?? undefined,
      boltsAffected: dbIssue.bolts_affected ?? undefined,
      createdAt: dbIssue.created_at as unknown as string,
      reportedAt: dbIssue.reported_at ?? undefined,
      reportedBy: dbIssue.reported_by ?? undefined,
      reportedByUid: dbIssue.reported_by_uid ?? undefined,
      approvedAt: dbIssue.approved_at ?? undefined,
      approvedByUid: dbIssue.approved_by_uid ?? undefined,
      archivedAt: dbIssue.archived_at ?? undefined,
      archivedByUid: dbIssue.archived_by_uid ?? undefined,
      lastModified: dbIssue.last_modified ?? undefined,
      lastStatus: dbIssue.last_status ?? undefined,
      isFlagged: dbIssue.is_flagged ? Boolean(dbIssue.is_flagged) : undefined,
      flaggedMessage: dbIssue.flagged_message ?? undefined,
    };
  }

  export function mapIssueAttachmentFromDb(dbAttachment: DB['issue_attachment']): Models.IssueAttachment {
    return {
      id: dbAttachment.id as unknown as number,
      issueId: dbAttachment.issue_id,
      url: dbAttachment.url,
      type: dbAttachment.type,
      name: dbAttachment.name ?? undefined,
      createdAt: dbAttachment.created_at as unknown as string ?? undefined,
    };
  }
  
  export function mapUserFromDb(dbUser: DB['user']): Models.User {
    return {
      uid: dbUser.uid,
      displayName: dbUser.display_name ?? undefined,
      email: dbUser.email ?? undefined,
      emailVerified: dbUser.email_verified ? Boolean(dbUser.email_verified) : undefined,
      avatarUrl: dbUser.avatar_url ?? undefined,
      providerId: dbUser.provider_id ?? undefined,
      role: dbUser.role ?? undefined,
      createdAt: dbUser.created_at as unknown as string ?? undefined,
    };
  }
  
  export function mapUserInviteFromDb(dbInvite: DB['user_invite']): Models.UserInvite {
    return {
      email: dbInvite.email,
      displayName: dbInvite.display_name ?? undefined,
      role: dbInvite.role ?? undefined,
      invitedByUid: dbInvite.invited_by_uid,
      invitedByName: dbInvite.invited_by_name,
      token: dbInvite.token ?? undefined,
      tokenExpires: dbInvite.token_expires ?? undefined,
      createdAt: dbInvite.created_at as unknown as string ?? undefined,
    };
  }
