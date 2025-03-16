
export interface Crag {
    id: number;
    name: string;
    latitude?: number;
    longitude?: number;
    hasSectors: boolean;
    createdAt?: string;
    statsActiveIssueCount?: number;
    statsIssueFlagged?: number;
    statsPublicIssueCount?: number;
  }

export interface Sector {
    id: number;
    name: string;
    cragId?: number;
    latitude?: number;
    longitude?: number;
    sortOrder?: number;
    createdAt?: string;
  }

export interface Route {
    id: number;
    name: string;
    sectorId?: number;
    sectorName?: string;
    cragName?: string;
    altNames?: string;
    boltCount?: number;
    climbStyle?: string;
    firstAscentBy?: string;
    firstAscentDate?: string;
    gradeYds?: string;
    latitude?: number;
    longitude?: number;
    pitchCount?: number;
    routeBuiltDate?: string;
    routeLength?: number;
    sortOrder?: number;
    status?: string;
    createdAt?: string;
  }

export interface Issue {
  id: number;
  routeId: number;
  issueType: string;
  subIssueType?: string;
  status: string;
  description?: string;
  boltsAffected?: string;
  createdAt: string;
  reportedAt?: string;
  reportedBy?: string;
  reportedByUid?: string;
  approvedAt?: string;
  approvedByUid?: string;
  archivedAt?: string;
  archivedByUid?: string;
  lastModified?: string;
  lastStatus?: string;
  isFlagged?: boolean;
  flaggedMessage?: string;
}

export interface IssueAttachment {
    id: number;
    issueId: number;
    url: string;
    type: string;
    name?: string;
    createdAt?: string;
  }

  export interface User {
    uid: string;
    displayName?: string;
    email?: string;
    emailVerified?: boolean;
    avatarUrl?: string;
    providerId?: string;
    role?: string;
    createdAt?: string;
  }

  export interface UserInvite {
    email: string;
    displayName?: string;
    role?: string;
    invitedByUid: string;
    invitedByName: string;
    token?: string;
    tokenExpires?: string;
    createdAt?: string;
  }
