import type { AppLoadContext } from "react-router";
import { getDB } from "./db";
import type { Crag, Sector, Route, Issue, IssueAttachment, TopoAttachment, Topo } from "./models";
import { redirect } from "react-router";
import { sql } from "kysely";
import { HIDDEN_TOPO_ISSUE_STATUSES } from "./constants";
import { parseAnnotationsJson } from "./topo.server";

function groupBy<T, K>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const item of items) {
        const key = getKey(item);
        const group = groups.get(key);
        if (group) {
            group.push(item);
        } else {
            groups.set(key, [item]);
        }
    }
    return groups;
}

async function loadAttachmentsForIssues(db: ReturnType<typeof getDB>, crag: Crag, issues: Issue[]): Promise<void> {
    if (!issues.length) return;

    const attachments = await db
        .selectFrom('issue_attachment')
        .innerJoin('issue', 'issue.id', 'issue_attachment.issue_id')
        .where('issue.crag_id', '=', crag.id)
        .where(eb => eb(sql<string>`lower(issue.status)`, 'not in', HIDDEN_TOPO_ISSUE_STATUSES))
        .select([
            'issue_attachment.id as id',
            'issue_attachment.issue_id as issueId',
            'issue_attachment.name as name',
            'issue_attachment.type as type',
            'issue_attachment.url as url',
            'issue_attachment.created_at as createdAt'
        ])
        .orderBy('issue_attachment.id')
        .execute() as IssueAttachment[];

    const attachmentsByIssue = groupBy(attachments, attachment => attachment.issueId);
    issues.forEach(issue => {
        issue.attachments = attachmentsByIssue.get(issue.id) ?? [];
        issue.attachments.forEach(attachment => {
            attachment.issue = issue;
        });
    });
}

async function loadIssuesForCrag(db: ReturnType<typeof getDB>, crag: Crag): Promise<void> {
    const issues = await db
        .selectFrom('issue')
        .where('crag_id', '=', crag.id)
        .where(eb => eb(sql<string>`lower(status)`, 'not in', HIDDEN_TOPO_ISSUE_STATUSES))
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
        // Route cards surface the first issue only, so flagged safety notices must sort first.
        .orderBy('is_flagged', 'desc')
        .orderBy('id', 'desc')
        .execute() as Issue[];

    const issuesByRoute = groupBy(issues, issue => issue.routeId);
    crag.sectors.forEach(sector => {
        sector.routes.forEach(route => {
            route.issues = issuesByRoute.get(route.id) ?? [];
            route.issues.forEach(issue => {
                issue.route = route;
            });
        });
    });

    // Load attachments for all issues
    await loadAttachmentsForIssues(db, crag, issues);
}

async function loadAttachmentsForRoutes(db: ReturnType<typeof getDB>, crag: Crag, routes: Route[], attachmentMap: Map<number, TopoAttachment>): Promise<void> {
    if (!routes.length) return;

    const attachmentResult = await db
        .selectFrom('route_attachment')
        .innerJoin('topo_attachment', 'route_attachment.attachment_id', 'topo_attachment.id')
        .innerJoin('route', 'route.id', 'route_attachment.route_id')
        .where('route.crag_id', '=', crag.id)
        .select([
            'topo_attachment.id as id',
            'route_attachment.route_id as routeId',
            'topo_attachment.url as url',
            'topo_attachment.type as type',
            'topo_attachment.name as name',
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

async function loadAttachmentsForSectors(db: ReturnType<typeof getDB>, crag: Crag, sectors: Sector[], attachments: TopoAttachment[]): Promise<Map<number, TopoAttachment>> {
    if (!sectors.length) return new Map<number, TopoAttachment>();

    const attachmentResult = await db
        .selectFrom('sector_attachment')
        .innerJoin('topo_attachment', 'sector_attachment.attachment_id', 'topo_attachment.id')
        .innerJoin('sector', 'sector.id', 'sector_attachment.sector_id')
        .where('sector.crag_id', '=', crag.id)
        .select([
            'topo_attachment.id as id',
            'sector_attachment.sector_id as sectorId',
            'topo_attachment.url as url',
            'topo_attachment.type as type',
            'topo_attachment.name as name',
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
    const attachmentData = await db
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
        .execute();

    // Initialize properly
    const attachments: TopoAttachment[] = attachmentData.map(data => ({
        ...data, // Spread fetched data (id, url, type, name, createdAt)
        routes: [], // Initialize explicitly
        sectors: [], // Initialize explicitly
        crags: [crag] // Initialize explicitly
    }));

    crag.attachments = attachments;
}

async function loadRoutesForCrag(db: ReturnType<typeof getDB>, crag: Crag, attachmentMap: Map<number, TopoAttachment>): Promise<void> {
    const routeData = await db
        .selectFrom('route')
        .where('crag_id', '=', crag.id)
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
            'notes',
        ])
        .orderBy('sector_id')
        .orderBy('sort_order')
        .orderBy('id')
        .execute();

    // Map to Route objects and initialize attachments immediately
    const routes: Route[] = routeData.map(data => ({
        ...data,
        issues: [],
        attachments: [], 
    }));

    // Group routes by sectorId safely without relying on pointer alignment
    const routesBySector = groupBy(routes, route => route.sectorId);
    crag.sectors.forEach(sector => {
        const sectorRoutes = routesBySector.get(sector.id) ?? [];
        sector.routes = sectorRoutes;
        sectorRoutes.forEach(route => {
            route.sector = sector;
        });
    });

    await loadAttachmentsForRoutes(db, crag, routes, attachmentMap);
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
            'notes',
        ])
        .orderBy('sort_order')
        .orderBy('id')
        .execute() as Sector[];

    // Set up crag-sector relationship
    crag.sectors = sectors;
    sectors.forEach(sector => {
        sector.crag = crag;
        sector.attachments = [];
        sector.routes = [];
    });

    // Load attachments for sectors
    const attachmentMap = await loadAttachmentsForSectors(db, crag, sectors, crag.attachments ?? []);
    // Load routes for all sectors
    await loadRoutesForCrag(db, crag, attachmentMap);
}

async function loadCrag(context: AppLoadContext, identifier: number | string, lookupColumn: 'id' | 'name' | 'slug'): Promise<Crag> {
    const db = getDB(context);

    // Get the base crag data
    const crag = await db
        .selectFrom('crag')
        .where(lookupColumn, '=', identifier)
        .select([
            'id',
            'name',
            'slug',
            'latitude',
            'longitude',
            'notes',
            'stats_active_issue_count as statsActiveIssueCount',
            'stats_issue_flagged as statsIssueFlagged',
            'stats_public_issue_count as statsPublicIssueCount',
        ])
        .executeTakeFirst() as Crag | undefined;

    if (!crag) {
        throw new Error(`Crag with ${lookupColumn} "${identifier}" not found`);
    }
    await loadAttachmentsForCrag(db, crag);
    // Load the full hierarchy
    await loadSectorsForCrag(db, crag);
    await loadIssuesForCrag(db, crag);
    await loadToposForCrag(db, crag);
    return crag;
}

async function loadToposForCrag(db: ReturnType<typeof getDB>, crag: Crag): Promise<void> {
    const routes = crag.sectors.flatMap(sector => sector.routes);
    routes.forEach(route => { route.topos = []; });

    if (routes.length === 0) return;

    const routeTopoRows = await db
        .selectFrom('route_topo')
        .innerJoin('route', 'route.id', 'route_topo.route_id')
        .where('route.crag_id', '=', crag.id)
        .select([
            'route_topo.topo_id as topoId',
            'route_topo.route_id as routeId',
            'route_topo.label as label',
            'route_topo.sort_order as sortOrder',
        ])
        .orderBy('route_topo.sort_order', 'asc')
        .orderBy('route_topo.topo_id', 'asc')
        .execute();

    if (routeTopoRows.length === 0) return;

    const topoIds = Array.from(new Set(routeTopoRows.map(r => r.topoId)));

    const topoRows = await db
        .selectFrom('topo')
        .where('id', 'in', topoIds)
        .where('status', '=', 'Active')
        .select([
            'id',
            'uuid',
            'crag_id as cragId',
            'sector_id as sectorId',
            'name',
            'description',
            'latitude',
            'longitude',
            'background_image_url as backgroundImageUrl',
            'background_image_hash as backgroundImageHash',
            'raster_image_url as rasterImageUrl',
            'raster_image_hash as rasterImageHash',
            'image_width as imageWidth',
            'image_height as imageHeight',
            'image_file_size as imageFileSize',
            'annotations_json as annotationsJson',
            'status',
            'created_at as createdAt',
            'updated_at as updatedAt',
        ])
        .execute();

    if (!topoRows.length) return;

    const topoMap = new Map<number, Topo>();
    topoRows.forEach(row => {
        topoMap.set(row.id, {
            id: row.id,
            uuid: row.uuid,
            cragId: row.cragId,
            sectorId: row.sectorId,
            name: row.name,
            description: row.description,
            latitude: row.latitude,
            longitude: row.longitude,
            backgroundImageUrl: row.backgroundImageUrl,
            backgroundImageHash: row.backgroundImageHash,
            rasterImageUrl: row.rasterImageUrl,
            rasterImageHash: row.rasterImageHash,
            imageWidth: row.imageWidth,
            imageHeight: row.imageHeight,
            imageFileSize: row.imageFileSize,
            annotations: parseAnnotationsJson(row.annotationsJson),
            routes: [],
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    });

    const routeMap = new Map(routes.map(r => [r.id, r]));
    routeTopoRows.forEach(mapping => {
        const topo = topoMap.get(mapping.topoId);
        const route = routeMap.get(mapping.routeId);
        if (topo && route) {
            if (!route.topos!.some(t => t.id === topo.id)) {
                route.topos!.push(topo);
            }
        }
    });
}

// Convenience wrappers for common use cases
export async function loadCragById(context: AppLoadContext, id: number): Promise<Crag> {
    return loadCrag(context, id, 'id');
}

export async function loadCragByName(context: AppLoadContext, name: string): Promise<Crag> {
    return loadCrag(context, name, 'name');
}

export async function loadCragBySlug(context: AppLoadContext, slug: string): Promise<Crag> {
    return loadCrag(context, slug, 'slug');
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

