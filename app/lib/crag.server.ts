import type { AppLoadContext } from "@remix-run/cloudflare";
import { getDB } from "./db";
import type { Crag, Sector, Route, Issue, IssueAttachment, TopoAttachment } from "./models";
import { redirect } from "@remix-run/cloudflare";
import { sql } from "kysely";

async function loadAttachmentsForIssues(db: ReturnType<typeof getDB>, issues: Issue[]): Promise<void> {
    const issueIds = issues.map(issue => issue.id);
    if (!issueIds.length) return;

    const attachments = await db
        .selectFrom('issue_attachment')
        .where('issue_id', 'in', issueIds)
        .select([
            'id',
            'issue_id as issueId',
            'name',
            'type',
            'url',
            'created_at as createdAt'
        ])
        .orderBy('issue_id')
        .execute() as IssueAttachment[];

    // Populate attachments using sequential scan
    let attachmentIndex = 0;
    issues.forEach(issue => {
        issue.attachments = [];
        while (attachmentIndex < attachments.length && attachments[attachmentIndex].issueId === issue.id) {
            const attachment = attachments[attachmentIndex];
            attachment.issue = issue;
            issue.attachments.push(attachment);
            attachmentIndex++;
        }
    });
}

async function loadIssuesForCrag(db: ReturnType<typeof getDB>, crag: Crag): Promise<void> {

    const issues = await db
        .selectFrom('issue')
        .where('crag_id', '=', crag.id)
        .select([
            'id',
            'description',
            'created_at as createdAt',
            'status',
            'route_id as routeId',
            'sub_issue_type as subIssueType',
            'issue_type as issueType',
            'bolts_affected as boltsAffected',
            'flagged_message as flaggedMessage',
            'is_flagged as isFlagged',
            'last_modified as lastModified',
            'reported_at as reportedAt',
        ])
        .orderBy('route_id')
        .execute() as Issue[];

    // Populate issues using sequential scan
    let issueIndex = 0;
    crag.sectors.forEach(sector => {
        sector.routes.forEach(route => {
            route.issues = [];
            while (issueIndex < issues.length && issues[issueIndex].routeId === route.id) {
                const issue = issues[issueIndex];
                issue.route = route;
                route.issues.push(issue);
                issueIndex++;
            }
        });
    });

    // Load attachments for all issues
    await loadAttachmentsForIssues(db, issues);
}

async function loadAttachmentsForRoutes(db: ReturnType<typeof getDB>, routes: Route[], attachmentMap: Map<number, TopoAttachment>): Promise<void> {
    const routeIds = routes.map(route => route.id);
    if (!routeIds.length) return;

    const routeIdWhereClause = 'route_id in (' + routeIds.join(',') + ')';
    const attachmentResult = await db
        .selectFrom('route_attachment')
        .innerJoin('topo_attachment', 'route_attachment.attachment_id', 'topo_attachment.id')
        .where((eb) => sql.raw(`${routeIdWhereClause}`))
        .select([
            'topo_attachment.id',
            'route_attachment.route_id as routeId',
            'url',
            'type',
            'name',
            'topo_attachment.created_at as createdAt'
        ])
        .execute();
    
    // First pass: Create unique TopoAttachment objects
    attachmentResult.forEach(result => {
        if (!attachmentMap.has(result.id)) {
            const attachment: TopoAttachment = {
                id: result.id,
                url: result.url,
                type: result.type,
                name: result.name,
                createdAt: result.createdAt,
                routes: [],
                sectors: [],
                crags: [],
            };
            attachmentMap.set(result.id, attachment);
        }
    });

    // Create a map of routes by ID for easy lookup
    const routeMap = new Map(routes.map(route => [route.id, route]));

    // Second pass: Build the bidirectional relationships
    attachmentResult.forEach(result => {
        const attachment = attachmentMap.get(result.id)!;
        const route = routeMap.get(result.routeId);
        if (route) {
            route.attachments!.push(attachment);
            attachment.routes.push(route);
        }
    });
}

async function loadAttachmentsForSectors(db: ReturnType<typeof getDB>, sectors: Sector[], attachments: TopoAttachment[]): Promise<Map<number, TopoAttachment>> {
    const sectorIds = sectors.map(sector => sector.id);
    if (!sectorIds.length) return new Map<number, TopoAttachment>();

    const attachmentResult = await db
        .selectFrom('sector_attachment')
        .innerJoin('topo_attachment', 'sector_attachment.attachment_id', 'topo_attachment.id')
        .where('sector_id', 'in', sectorIds)
        .select([
            'topo_attachment.id',
            'sector_attachment.sector_id as sectorId',
            'url',
            'type',
            'name',
            'topo_attachment.created_at as createdAt'
        ])
        .execute();

    // Create a map to store unique TopoAttachments by their ID
    const attachmentMap = new Map<number, TopoAttachment>();

    // Add existing (crag) attachments to the map
    attachments.forEach(attachment => {
        attachmentMap.set(attachment.id, attachment);
    });
    attachmentResult.forEach(result => {
        if (!attachmentMap.has(result.id)) {
            const attachment: TopoAttachment = {
                id: result.id,
                url: result.url,
                type: result.type,
                name: result.name,
                createdAt: result.createdAt,
                routes: [],
                sectors: [],
                crags: [],
            };
            attachmentMap.set(result.id, attachment);
        }
    });

    // Create a map of sectors by ID for easy lookup
    const sectorMap = new Map(sectors.map(sector => [sector.id, sector]));

    // Second pass: Build the bidirectional relationships
    attachmentResult.forEach(result => {
        const attachment = attachmentMap.get(result.id)!;
        const sector = sectorMap.get(result.sectorId);
        if (sector) {
            sector.attachments!.push(attachment);
            attachment.sectors.push(sector);
        }
    });
    return attachmentMap;
}

async function loadAttachmentsForCrag(db: ReturnType<typeof getDB>, crag: Crag): Promise<void> {
    const attachments = await db
        .selectFrom('crag_attachment')
        .innerJoin('topo_attachment', 'crag_attachment.attachment_id', 'topo_attachment.id')
        .where('crag_id', '=', crag.id)
        .select([
            'topo_attachment.id',
            'url',
            'type',
            'name',
            'topo_attachment.created_at as createdAt'
        ])
        .execute() as TopoAttachment[];

    crag.attachments = attachments;
    attachments.forEach(attachment => {
        attachment.crags = [crag];
        attachment.routes = [];
        attachment.sectors = [];
    });
}



async function loadRoutesForCrag(db: ReturnType<typeof getDB>, crag: Crag, attachmentMap: Map<number, TopoAttachment>): Promise<void> {
    const routes = await db
        .selectFrom('route')
        .where('sector_id', 'in', crag.sectors.map(sector => sector.id))
        .select([
            'id',
            'name',
            'sector_id as sectorId',
            'grade_yds as gradeYds',
            'climb_style as climbStyle',
            'bolt_count as boltCount',
            'first_ascent_by as firstAscentBy',
            'route_length as routeLength',
            'status',
            'alt_names as altNames',
            'first_ascent_date as firstAscentDate',
            'latitude',
            'longitude',
            'pitch_count as pitchCount',
            'route_built_date as routeBuiltDate',
            'sort_order as sortOrder',
            'year',
        ])
        .orderBy('sector_id')
        .execute() as Route[];

    // Populate routes using sequential scan
    let routeIndex = 0;
    crag.sectors.forEach(sector => {
        sector.routes = [];
        while (routeIndex < routes.length && routes[routeIndex].sectorId === sector.id) {
            const route = routes[routeIndex];
            route.sector = sector;
            route.attachments = [];
            sector.routes.push(route);
            routeIndex++;
        }
    });
    await loadAttachmentsForRoutes(db, routes, attachmentMap);
    await loadIssuesForCrag(db, crag);
}

async function loadSectorsForCrag(db: ReturnType<typeof getDB>, crag: Crag): Promise<void> {
    let sectors: Sector[] = [];
    sectors = await db
        .selectFrom('sector')
        .where('crag_id', '=', crag.id)
        .select([
            'id',
            'name',
            'crag_id as cragId',
            'latitude',
            'longitude',
            'sort_order as sortOrder',
        ])
        .orderBy('sort_order')
        .orderBy('id')
        .execute() as Sector[];

    // Set up crag-sector relationship
    crag.sectors = sectors;
    sectors.forEach(sector => {
        sector.crag = crag;
        sector.attachments = [];
    });

    // Load attachments for sectors
    const attachmentMap = await loadAttachmentsForSectors(db, sectors, crag.attachments ?? []);
    // Load routes for all sectors
    await loadRoutesForCrag(db, crag, attachmentMap);
}

async function loadCrag(context: AppLoadContext, identifier: number | string): Promise<Crag> {
    const db = getDB(context);

    // Get the base crag data
    const crag = await db
        .selectFrom('crag')
        .where(typeof identifier === 'number' ? 'id' : 'name', '=', identifier)
        .select([
            'id',
            'name',
            'latitude',
            'longitude',
            'stats_active_issue_count as statsActiveIssueCount',
            'stats_issue_flagged as statsIssueFlagged',
            'stats_public_issue_count as statsPublicIssueCount',
        ])
        .executeTakeFirst() as Crag | undefined;

    if (!crag) {
        throw new Error(`Crag with ${typeof identifier === 'number' ? 'id' : 'name'} "${identifier}" not found`);
    }
    await loadAttachmentsForCrag(db, crag);
    // Load the full hierarchy
    await loadSectorsForCrag(db, crag);
    return crag;
}

// Convenience wrappers for common use cases
export async function loadCragById(context: AppLoadContext, id: number): Promise<Crag> {
    return loadCrag(context, id);
}

export async function loadCragByName(context: AppLoadContext, name: string): Promise<Crag> {
    return loadCrag(context, name);
}

export async function deleteCrag(context: AppLoadContext, cragId: number): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDB(context);

        if (!cragId) {
            return { success: false, error: "Crag ID is required" };
        }

        // Check if crag has any sectors
        const sectors = await db.selectFrom('sector')
            .select('id')
            .where('crag_id', '=', cragId)
            .execute();

        if (sectors.length > 0) {
            return { success: false, error: "Cannot delete crag with sectors" };
        }

        // Delete the crag
        await db.deleteFrom('crag')
            .where('id', '=', cragId)
            .execute();

        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to delete crag" };
    }
}

