import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export interface _CfKV {
  key: string;
  value: Buffer | null;
}

export interface Area {
  crag_id: number | null;
  created_at: Generated<string>;
  data_source: string | null;
  id: Generated<number>;
  latitude: number | null;
  longitude: number | null;
  name: string;
  sloper_sector_id: number | null;
}

export interface AttachmentAuditLog {
  action: string;
  after_name: string | null;
  attachment_id: number;
  before_name: string | null;
  id: Generated<number>;
  issue_id: number | null;
  timestamp: Generated<string>;
  type: string | null;
  uid: string | null;
  url: string | null;
  user_display_name: string | null;
  user_role: string | null;
}

export interface Crag {
  created_at: Generated<string | null>;
  has_sectors: Generated<number>;
  id: Generated<number>;
  latitude: number | null;
  longitude: number | null;
  name: string;
  stats_active_issue_count: number | null;
  stats_issue_flagged: number | null;
  stats_public_issue_count: number | null;
}

export interface D1Migrations {
  applied_at: Generated<string>;
  id: Generated<number | null>;
  name: string | null;
}

export interface ExternalCragRef {
  external_id: string;
  local_id: number | null;
  source: string;
  sync_children: Generated<number | null>;
  sync_data: Generated<number | null>;
}

export interface ExternalIssueRef {
  external_id: string;
  external_route_id: string;
  local_id: number | null;
  source: string;
  sync_data: Generated<number | null>;
}

export interface ExternalRouteRef {
  external_id: string;
  external_sector_id: string;
  forced_name: string | null;
  local_id: number | null;
  source: string;
  sync_data: Generated<number | null>;
}

export interface ExternalSectorRef {
  external_crag_id: string;
  external_id: string;
  local_id: number | null;
  source: string;
  sync_children: Generated<number | null>;
  sync_data: Generated<number | null>;
}

export interface Issue {
  approved_at: string | null;
  approved_by_uid: string | null;
  archived_at: string | null;
  archived_by_uid: string | null;
  bolts_affected: string | null;
  created_at: Generated<string>;
  description: string | null;
  flagged_message: string | null;
  id: Generated<number>;
  is_flagged: number | null;
  issue_type: string;
  last_modified: string | null;
  last_status: string | null;
  reported_at: string | null;
  reported_by: string | null;
  reported_by_uid: string | null;
  route_id: number;
  status: string;
  sub_issue_type: string | null;
}

export interface IssueAttachment {
  created_at: Generated<string | null>;
  id: Generated<number>;
  issue_id: number;
  name: string | null;
  type: string;
  url: string;
}

export interface IssueAuditLog {
  action: string;
  after_bolts_affected: string | null;
  after_description: string | null;
  after_flagged_message: string | null;
  after_is_flagged: number | null;
  after_issue_type: string | null;
  after_route_id: number | null;
  after_status: string | null;
  after_sub_issue_type: string | null;
  before_bolts_affected: string | null;
  before_description: string | null;
  before_flagged_message: string | null;
  before_is_flagged: number | null;
  before_issue_type: string | null;
  before_route_id: number | null;
  before_status: string | null;
  before_sub_issue_type: string | null;
  id: Generated<number>;
  issue_id: number;
  timestamp: Generated<string>;
  uid: string | null;
  user_display_name: string | null;
  user_role: string | null;
}

export interface Route {
  alt_names: string | null;
  bolt_count: number | null;
  climb_style: string | null;
  crag_name: string | null;
  created_at: Generated<string | null>;
  first_ascent_by: string | null;
  first_ascent_date: string | null;
  grade_yds: string | null;
  id: Generated<number>;
  latitude: number | null;
  longitude: number | null;
  name: string;
  pitch_count: number | null;
  route_built_date: string | null;
  route_length: number | null;
  sector_id: number | null;
  sector_name: string | null;
  sort_order: number | null;
  status: string | null;
}

export interface RouteSearch {
  bolt_count: string | null;
  crag_name: string | null;
  grade_yds: string | null;
  name: string | null;
  pitch_count: string | null;
  sector_name: string | null;
}

export interface RouteSearchConfig {
  k: string;
  v: string | null;
}

export interface RouteSearchData {
  block: Buffer | null;
  id: number | null;
}

export interface RouteSearchDocsize {
  id: number | null;
  sz: Buffer | null;
}

export interface RouteSearchIdx {
  pgno: string | null;
  segid: string;
  term: string;
}

export interface Sector {
  crag_id: number | null;
  created_at: Generated<string | null>;
  id: Generated<number>;
  latitude: number | null;
  longitude: number | null;
  name: string;
  sort_order: number | null;
}

export interface SigninEvent {
  signin_at: Generated<string>;
  signin_id: Generated<number>;
  uid: string;
}

export interface User {
  avatar_url: string | null;
  created_at: Generated<string | null>;
  display_name: string | null;
  email: string | null;
  email_verified: number | null;
  provider_id: string | null;
  role: string | null;
  uid: string;
}

export interface UserInvite {
  created_at: Generated<string | null>;
  display_name: string | null;
  email: string;
  invited_by_name: string;
  invited_by_uid: string;
  role: string | null;
  token: string | null;
  token_expires: string | null;
}

export interface DB {
  _cf_KV: _CfKV;
  area: Area;
  attachment_audit_log: AttachmentAuditLog;
  crag: Crag;
  d1_migrations: D1Migrations;
  external_crag_ref: ExternalCragRef;
  external_issue_ref: ExternalIssueRef;
  external_route_ref: ExternalRouteRef;
  external_sector_ref: ExternalSectorRef;
  issue: Issue;
  issue_attachment: IssueAttachment;
  issue_audit_log: IssueAuditLog;
  route: Route;
  route_search: RouteSearch;
  route_search_config: RouteSearchConfig;
  route_search_data: RouteSearchData;
  route_search_docsize: RouteSearchDocsize;
  route_search_idx: RouteSearchIdx;
  sector: Sector;
  signin_event: SigninEvent;
  user: User;
  user_invite: UserInvite;
}
