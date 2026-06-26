type SyncAttachment = {
  id: number;
  url: string;
  name: string | null;
  type: string;
};

export type ApiCrag = {
  id: number;
  name: string;
  slug: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  statsActiveIssueCount: number | null;
  statsIssueFlagged: number | null;
  statsPublicIssueCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  attachments: SyncAttachment[];
};

export type ApiSector = {
  id: number;
  cragId: number | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  sortOrder: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  attachments: SyncAttachment[];
};

export type ApiRoute = {
  id: number;
  cragId: number | null;
  sectorId: number | null;
  name: string;
  altNames: string | null;
  gradeYds: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  sortOrder: number | null;
  boltCount: number | null;
  pitchCount: number | null;
  routeLength: number | null;
  climbStyle: string | null;
  year: number | null;
  routeBuiltDate: string | null;
  firstAscentBy: string | null;
  firstAscentDate: string | null;
  cragName: string | null;
  sectorName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  attachments: SyncAttachment[];
};

// SQLite CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS", UTC).
export function formatSqliteTimestamp(date = new Date()) {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export function serverTimeFromUpdatedRows(rows: { updated_at: string | null }[], since: string | null) {
  const maxUpdatedAt = rows.reduce<string | null>((max, row) => {
    if (!row.updated_at) return max;
    return !max || row.updated_at > max ? row.updated_at : max;
  }, null);
  return maxUpdatedAt ?? since ?? formatSqliteTimestamp();
}

export function toApiCrag(row: {
  id: number;
  name: string;
  slug: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  stats_active_issue_count: number | null;
  stats_issue_flagged: number | null;
  stats_public_issue_count: number | null;
  created_at: string | null;
  updated_at: string | null;
}): ApiCrag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
    statsActiveIssueCount: row.stats_active_issue_count,
    statsIssueFlagged: row.stats_issue_flagged,
    statsPublicIssueCount: row.stats_public_issue_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: [],
  };
}

export function toApiSector(row: {
  id: number;
  crag_id: number | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
}): ApiSector {
  return {
    id: row.id,
    cragId: row.crag_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: [],
  };
}

export function toApiRoute(row: {
  id: number;
  crag_id: number | null;
  sector_id: number | null;
  name: string;
  alt_names: string | null;
  grade_yds: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  sort_order: number | null;
  bolt_count: number | null;
  pitch_count: number | null;
  route_length: number | null;
  climb_style: string | null;
  year: number | null;
  route_built_date: string | null;
  first_ascent_by: string | null;
  first_ascent_date: string | null;
  crag_name: string | null;
  sector_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}): ApiRoute {
  return {
    id: row.id,
    cragId: row.crag_id,
    sectorId: row.sector_id,
    name: row.name,
    altNames: row.alt_names,
    gradeYds: row.grade_yds,
    status: row.status,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
    sortOrder: row.sort_order,
    boltCount: row.bolt_count,
    pitchCount: row.pitch_count,
    routeLength: row.route_length,
    climbStyle: row.climb_style,
    year: row.year,
    routeBuiltDate: row.route_built_date,
    firstAscentBy: row.first_ascent_by,
    firstAscentDate: row.first_ascent_date,
    cragName: row.crag_name,
    sectorName: row.sector_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: [],
  };
}
