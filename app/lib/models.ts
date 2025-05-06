export interface Crag {
    id: number;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    sectors: Sector[];
    attachments?: TopoAttachment[];
    createdAt?: string | null;
    statsActiveIssueCount?: number | null;
    statsIssueFlagged?: number | null;
    statsPublicIssueCount?: number | null;
    notes?: string | null;
}

export interface Sector {
    id: number;
    name: string;
    cragId?: number | null;
    crag?: Crag;
    routes: Route[];
    attachments?: TopoAttachment[];
    latitude?: number | null;
    longitude?: number | null;
    sortOrder?: number | null;
    createdAt?: string | null;
    notes?: string | null;
}

export interface Route {
    id: number;
    name: string;
    sectorId?: number | null;
    sector?: Sector;
    sectorName?: string | null;
    cragId?: number | null;
    cragName?: string | null;
    crag?: Crag | null;
    issues: Issue[];
    attachments?: TopoAttachment[];
    altNames?: string | null;
    boltCount?: number | null;
    climbStyle?: string | null;
    firstAscentBy?: string | null;
    firstAscentDate?: string | null;
    gradeYds?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    pitchCount?: number | null;
    routeBuiltDate?: string | null;
    routeLength?: number | null;
    sortOrder?: number | null;
    status?: string | null;
    createdAt?: string | null;
    year?: number | null;
    notes?: string | null;
}

export interface RouteSearchResults {
    routeId?: number | null;
    sectorId?: number | null;
    cragId?: number | null;
    type: string;
    routeName?: string | null;
    routeAltNames?: string | null;
    sectorName?: string | null;
    cragName?: string | null;
    gradeYds?: string | null;
    boltCount?: string | null;
    pitchCount?: string | null;
}

export interface ImportNotes {
    id: number;
    cragId?: number | null;
    sectorId?: number | null;
    routeId?: number | null;
    createdAt?: string | null;
    notes?: string | null;
    otherUrls?: string | null;
    topoUrl?: string | null;
    downloadResult?: string | null;
    uploadResult?: string | null;
}

export interface Issue {
    id: number;
    routeId: number;
    route?: Route;
    attachments?: IssueAttachment[];
    issueType: string;
    subIssueType?: string | null;
    status: string;
    description?: string | null;
    boltsAffected?: string | null;
    createdAt?: string;
    reportedAt?: string | null;
    reportedBy?: string | null;
    reportedByUid?: string | null;
    approvedAt?: string | null;
    approvedByUid?: string | null;
    archivedAt?: string | null;
    archivedByUid?: string | null;
    lastModified?: string | null;
    lastStatus?: string | null;
    isFlagged?: boolean | null;
    flaggedMessage?: string | null;
}

export interface IssueWithDetails extends Issue {
    sectorName?: string | null;
    cragName?: string | null;
    routeName?: string;
}

export interface IssueAttachment {
    id: number;
    issueId: number;
    issue?: Issue;
    url: string;
    type: string;
    name?: string | null;
    createdAt?: string | null;
}

export interface User {
    uid: string;
    displayName?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    avatarUrl?: string | null;
    providerId?: string | null;
    role?: string | null;
    createdAt?: string | null;
    disclaimerAckDate?: string | null;
}

export interface UserInvite {
    email: string;
    user?: User;
    displayName?: string | null;
    role?: string | null;
    invitedByUid: string;
    invitedByName: string;
    token?: string | null;
    tokenExpires?: string | null;
    createdAt?: string | null;
}

export interface TopoAttachment {
    id: number;
    url: string;
    type: string;
    name?: string | null;
    routes: Route[];
    sectors: Sector[];
    crags: Crag[];
    createdAt?: string | null;
}
