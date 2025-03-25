export interface Crag {
    id: number;
    name: string;
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    hasSectors: boolean | null | undefined;
    sectors: Sector[];
    attachments?: TopoAttachment[];
    createdAt: string | null | undefined;
    statsActiveIssueCount: number | null | undefined;
    statsIssueFlagged: number | null | undefined;
    statsPublicIssueCount: number | null | undefined;
}

export interface Sector {
    id: number;
    name: string;
    cragId: number | null | undefined;
    crag?: Crag;
    routes: Route[];
    attachments?: TopoAttachment[];
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    sortOrder: number | null | undefined;
    createdAt: string | null | undefined;
}

export interface Route {
    id: number;
    name: string;
    sectorId: number | null | undefined;
    sector?: Sector;
    sectorName: string | null | undefined;
    cragName: string | null | undefined;
    crag?: Crag | null | undefined;
    issues: Issue[];
    attachments?: TopoAttachment[];
    altNames: string | null | undefined;
    boltCount: number | null | undefined;
    climbStyle: string | null | undefined;
    firstAscentBy: string | null | undefined;
    firstAscentDate: string | null | undefined;
    gradeYds: string | null | undefined;
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    pitchCount: number | null | undefined;
    routeBuiltDate: string | null | undefined;
    routeLength: number | null | undefined;
    sortOrder: number | null | undefined;
    status: string | null | undefined;
    createdAt: string | null | undefined;
}

export interface Issue {
    routeName: string | number | readonly string[] | undefined;
    id: number;
    routeId: number;
    route?: Route;
    attachments: IssueAttachment[];
    issueType: string;
    subIssueType: string | null | undefined;
    status: string;
    description: string | null | undefined;
    boltsAffected: string | null | undefined;
    createdAt: string;
    reportedAt: string | null | undefined;
    reportedBy: string | null | undefined;
    reportedByUid: string | null | undefined;
    approvedAt: string | null | undefined;
    approvedByUid: string | null | undefined;
    archivedAt: string | null | undefined;
    archivedByUid: string | null | undefined;
    lastModified: string | null | undefined;
    lastStatus: string | null | undefined;
    isFlagged: boolean | null | undefined;
    flaggedMessage: string | null | undefined;
}

export interface IssueAttachment {
    id: number;
    issueId: number;
    issue?: Issue;
    url: string;
    type: string;
    name: string | null | undefined;
    createdAt: string | null | undefined;
}

export interface User {
    uid: string;
    displayName: string | null | undefined;
    email: string | null | undefined;
    emailVerified: boolean | null | undefined;
    avatarUrl: string | null | undefined;
    providerId: string | null | undefined;
    role: string | null | undefined;
    createdAt: string | null | undefined;
}

export interface UserInvite {
    email: string;
    user?: User;
    displayName: string | null | undefined;
    role: string | null | undefined;
    invitedByUid: string;
    invitedByName: string;
    token: string | null | undefined;
    tokenExpires: string | null | undefined;
    createdAt: string | null | undefined;
}

export interface TopoAttachment {
    id: number;
    url: string;
    type: string;
    name: string | null | undefined;
    routes: Route[];
    sectors: Sector[];
    crags: Crag[];
    createdAt: string | null | undefined;
}
