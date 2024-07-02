/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppLoadContext } from "@remix-run/cloudflare";
import { getDB } from "./db";
import he from 'he';
import { Kysely } from "kysely";
import { DB, Issue } from "kysely-codegen";
import { nanoid } from "nanoid";
import { parse } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { getLogMessages, clearLogMessages } from "./logger";

const SLOPER_AUTH_PATH = "/DesktopModules/JwtAuth/API/mobile/login"
const SLOPER_ROUTES_PATH = "/API/SloperPlatform/Route/?isEnabled=1";
//const SLOPER_SECTORS_PATH = "/API/SloperPlatform/Sector/?isEnabled=1";
const SLOPER_CRAGS_PATH = "/API/SloperPlatform/CragTest/?isEnabled=1";
const SLOPER_ISSUES_PATH = "/API/SloperPlatform/RouteIssues/";
const SLOPER_ISSUE_CREATE_PATH = "/DesktopModules/SloperPlatform/API/v190901/M/LogUserIssue";
const SLOPER_GUIDEBOOKS = ["11", "22"]; //the two guidebook IDs relevant to the area. 22 (Banff Rock) should go after 11 so it overwrites duplicates.

interface SloperIssue {
    issue_id: string,
    issue_category_id: string,
    issue_type_id: string,
    issue_type_detail_id: string,
    route_id: string,
    status: string,
    comments: string,
    bolt_numbers: string,  //e.g. 1|2|3
    TROUTE: {
        route_safety_notice: string,
    },
    user_name: string,
    date_reported: string,
    date_modified: string,
}

const sloperTypeIdMap = new Map<number, string>([
    [0, ""],
    [1, "Loose"], //Loose (leads to Loose nut, bolt loose, glue issue, other)
    [2, "Missing"], //Hardware Missing (leads to All, Hangers, Nut, Bolt)
    [3, "Worn"], //Aged  (leads to Rusted, Outdated, Worn, Other)
    [4, "Loose block"], //Loose Block
    [5, "Loose flake"], //Loose Flake
    [6, "Loose block"], //Rock Perched
]);

const sloperDetailIdMap = new Map<number, string>([
    [1, "Missing (bolt and hanger)"],
    [2, "Loose nut"],
    [3, "Loose bolt"],
    [4, "Loose glue-in"],
    [5, "Missing (hanger)"],
    [6, "Missing (hanger)"],
    [7, "Missing (bolt and hanger)"],
    [8, "Rusted"],
    [9, "Outdated"],
    [10, "Worn"],
    [11, "Other"],
]);

const sloperStatusIdMap = new Map<number, string>([
    [1, "Reported"],
    [2, "Viewed"],
    [3, "In Progress"],
    [4, "Completed"],
    [5, "In Moderation"],
]);

function convertSloperDateTime(sloperDT: string): string {
    const date = parse(sloperDT, 'M/d/yyyy h:mm:ss a', new Date());
    const utcDate = fromZonedTime(date, 'America/Denver');
    return utcDate.toISOString();
}

function convertSloperToTabvarTypes(sloperCatId: number, sloperTypeId: number, sloperDetailId: number): { issueType: string, subIssueType: string | null } {
    const sloperCategoryIdMap = new Map<number, string>([
        [0, "Unknown"], // Not normally available for selection
        [1, "All Bolts"], //All Bolts
        [2, "Bolts"], //Single Bolt(s)
        [3, "Anchor"], //Anchors
        [4, "Rock"], //Rock Quality
    ]);
    const issueType: string = sloperCategoryIdMap.get(sloperCatId) ?? "Unknown";
    let subIssueType = sloperTypeIdMap.get(sloperTypeId) ?? null;
    if (sloperDetailIdMap.has(sloperDetailId)) subIssueType = sloperDetailIdMap.get(sloperDetailId) ?? null;
    return { issueType, subIssueType };
}

export function importSloperIssueMetadata(sloperIssue: SloperIssue): Partial<Issue> {
    const issue: Partial<Issue> = {
        description: "",
    };
    if (sloperIssue.comments) {
        issue.description = he.decode(sloperIssue.comments.trim());
    }
    if (sloperIssue.TROUTE.route_safety_notice) {
        issue.flagged_message = he.decode(sloperIssue.TROUTE.route_safety_notice.trim());
        issue.is_flagged = 1;
    } else issue.is_flagged = 0;
    const { issueType, subIssueType } = convertSloperToTabvarTypes(Number(sloperIssue.issue_category_id), Number(sloperIssue.issue_type_id), Number(sloperIssue.issue_type_detail_id));
    issue.issue_type = issueType;
    issue.sub_issue_type = subIssueType;
    issue.status = sloperStatusIdMap.get(Number(sloperIssue.status));
    issue.bolts_affected = sloperIssue.bolt_numbers; //formatted as 1|2|3
    issue.reported_at = convertSloperDateTime(sloperIssue.date_reported);
    issue.last_modified = convertSloperDateTime(sloperIssue.date_modified);
    issue.reported_by = he.decode(sloperIssue.user_name);
    return issue;
}

async function getSloperAuth(context: AppLoadContext): Promise<string | null> {
    const response = await fetch(context.cloudflare.env.SLOPER_URL + SLOPER_AUTH_PATH, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': '*/*',
        },
        body: JSON.stringify({
            u: context.cloudflare.env.SLOPER_ID,
            p: context.cloudflare.env.SLOPER_P
        }),
    });
    if (!response.ok) {
        throw new Error('Sloper auth failed');
    }
    const loginData = await response.json() as { accessToken: string };
    const authToken = loginData.accessToken;
    if (!authToken) {
        throw new Error('No AuthToken found in Auth response');
    }
    return authToken;
}

export interface SloperResponse<T> {
    data: T[];
    [key: string]: any;
}

async function getSloperData<T>(context: AppLoadContext, path: string, method: string = "GET"): Promise<SloperResponse<T>> {
    const token = await getSloperAuth(context);
    const response = await fetch(context.cloudflare.env.SLOPER_URL + path, {
        method: method,
        headers: {
            'Accept': '*/*',
            'Authorization': `Bearer ${token}`,
        },
    });
    return await response.json();
}

async function updateCrags(context: AppLoadContext, cragData: any[]): Promise<[number, number, number]> {
    const db = getDB(context);
    let updateCount = 0, insertCount = 0, dupeCount = 0;
    for (const crag of cragData) {
        const cragRef = await db.selectFrom("external_crag_ref")
            .where((eb) => eb.and([
                eb("external_id", '=', crag.TCRAG?.crag_id.toString()),
                eb("source", "=", "sloper")
            ]))
            .select(["local_id", "sync_data"]).executeTakeFirst();

        if (cragRef !== undefined) {
            if (!cragRef?.sync_data || cragRef?.local_id === null) continue;
            try {
                await db.updateTable('crag')
                    .set({
                        name: he.decode(crag.TCRAG?.crag_name).trim(),
                        latitude: crag.TCRAG?.latitude,
                        longitude: crag.TCRAG?.longitude,
                    }).where("crag.id", "=", cragRef?.local_id)
                    .executeTakeFirst();
                updateCount++;
            } catch (error: any) {
                console.error(`Found but failed to update crag with external data: ${error.message}`);
            }
        }
        else {
            try {
                const insertResult = await db.insertInto('crag')
                    .values({
                        name: he.decode(crag.TCRAG?.crag_name).trim(),
                        latitude: crag.TCRAG?.latitude,
                        longitude: crag.TCRAG?.longitude,
                    })
                    .executeTakeFirst();
                await db.insertInto('external_crag_ref')
                    .values({
                        local_id: Number(insertResult.insertId),
                        external_id: crag.TCRAG?.crag_id.toString(),
                        source: "sloper",
                    }).execute();
                insertCount++;
            }
            catch (error: any) {
                if (error.message.endsWith("crag.name")) {
                    const existingDuplicate = await db.selectFrom("crag")
                        .where("crag.name", "=", he.decode(crag.TCRAG?.crag_name).trim())
                        .select("crag.id").executeTakeFirstOrThrow();
                    await db.insertInto('external_crag_ref')
                        .values({
                            local_id: existingDuplicate.id,
                            external_id: crag.TCRAG?.crag_id.toString(),
                            source: "sloper",
                            sync_data: 0,
                        }).execute();
                    dupeCount++;
                    console.log(`duplicate crag found: ${he.decode(crag.TCRAG?.crag_name).trim()} with sloper id ${crag.TCRAG?.crag_id}`)
                }
                else console.error(error.message);
            }
        }
    }
    return [insertCount, updateCount, dupeCount];
}

//temporarily made to use crag data as source until sector API call permissions work w/ mobile creds
async function updateSectorsTemp(context: AppLoadContext, cragData: any[]): Promise<[number, number, number]> {
    const db = getDB(context);
    let updateCount = 0, insertCount = 0, dupeCount = 0;
    for (const crag of cragData) {
        const cragRef = await db.selectFrom('external_crag_ref')
            .where((eb) => eb.and([
                eb("external_crag_ref.external_id", "=", crag.TCRAG?.crag_id.toString()),
                eb("source", "=", "sloper")
            ])).select(["local_id", "external_id", "sync_children"])
            .executeTakeFirst();
        if (cragRef === undefined || cragRef.local_id === null || !cragRef.sync_children) continue;

        for (const sector of crag.TSECTOR) {
            const sectorRef = await db.selectFrom("external_sector_ref")
                .where((eb) => eb.and([
                    eb("external_id", '=', sector.sector_id.toString()),
                    eb("source", "=", "sloper")
                ]))
                .select(["local_id", "sync_data"]).executeTakeFirst();
            if (sectorRef !== undefined) {
                if (!sectorRef?.sync_data || sectorRef?.local_id === null) continue;
                //found, updating
                try {
                    await db.updateTable('sector')
                        .set({
                            name: he.decode(sector.sector_name).trim(),
                            crag_id: cragRef.local_id,
                        }).where("sector.id", "=", sectorRef?.local_id)
                        .executeTakeFirst();
                    updateCount++;
                } catch (error: any) {
                    console.error(`Found but failed to update sector with external data: ${error.message}`);
                }
            }
            else {
                //not found, inserting
                try {
                    const insertResult = await db.insertInto('sector')
                        .values({
                            name: he.decode(sector.sector_name).trim(),
                            crag_id: cragRef.local_id,
                        })
                        .executeTakeFirst();
                    await db.insertInto('external_sector_ref')
                        .values({
                            local_id: Number(insertResult.insertId),
                            external_id: sector.sector_id,
                            external_crag_id: cragRef.external_id,
                            source: "sloper",
                        }).execute();
                    insertCount++;
                }
                catch (error: any) {
                    if (error.message.includes("sector.name")) {
                        //duplicate found, reference it
                        const existingDuplicate = await db.selectFrom("sector")
                            .where((eb) => eb.and([
                                eb("sector.name", "=", he.decode(sector.sector_name).trim()),
                                eb("sector.crag_id", "=", cragRef.local_id)
                            ]))
                            .select("sector.id").executeTakeFirstOrThrow();
                        await db.insertInto('external_sector_ref')
                            .values({
                                local_id: existingDuplicate.id,
                                external_id: sector.sector_id.toString(),
                                external_crag_id: cragRef.external_id,
                                sync_data: 0,
                                source: "sloper",
                            }).execute();
                        dupeCount++;
                        console.log(`duplicate sector found: ${he.decode(sector.sector_name).trim()} with sloper id ${sector.sector_id}`)
                    }
                    else console.error(error.message);
                }
            }
        }
    }
    return [insertCount, updateCount, dupeCount];
}

async function updateRoutes(context: AppLoadContext, externalSectorId: string, sectorId: number): Promise<[number, number, number]> {
    const db = getDB(context);
    let updateCount = 0, insertCount = 0, dupeCount = 0;
    const routeResponse = await getSloperData<any>(context, SLOPER_ROUTES_PATH + `&sectorId=${externalSectorId}`);
    const routes = routeResponse.data;
    console.log(`found ${routes.length} routes for sector id ${sectorId} (sloper id ${externalSectorId})`);
    for (const route of routes) {
        if (route.TROUTE_TYPE?.route_type.trim() == "Bouldering") continue;
        const routeRef = await db.selectFrom("external_route_ref")
            .where((eb) => eb.and([
                eb("external_id", '=', route.TROUTE?.route_id.toString()),
                eb("source", "=", "sloper")
            ]))
            .select(["local_id", "sync_data", "external_sector_id", "forced_name"]).executeTakeFirst();
        if (routeRef !== undefined) {
            if (!routeRef?.sync_data || routeRef?.local_id === null) continue;
            //found, updating
            try {
                let name = he.decode(route.TROUTE?.route_name).trim();
                if (routeRef.forced_name) name = routeRef.forced_name;
                await db.updateTable('route')
                    .set({
                        name: name,
                        sector_id: sectorId,
                        grade_yds: route.TTECH_GRADE?.tech_grade.trim(),
                        climb_style: route.TROUTE_TYPE?.route_type.trim(),
                        sort_order: route.TROUTE?.sort_order,
                        bolt_count: route.TROUTE?.number_of_bolts,
                        first_ascent_by: he.decode(route.TROUTE?.first_ascent_name).trim(),
                        first_ascent_date: route.TROUTE?.first_ascent_date,
                        route_built_date: route.TROUTE?.route_set_date,
                        route_length: route.TROUTE?.route_length,
                    }).where("route.id", "=", routeRef?.local_id)
                    .executeTakeFirst();
                updateCount++;
            } catch (error: any) {
                console.error(`Failed to update existing route ${he.decode(route.TROUTE?.route_name).trim()} (${route.TROUTE?.route_id.toString()}) in sectorid ${sectorId} with external data: ${error.message}`);
            }
        }
        else {
            //not found, inserting
            try {
                const insertResult = await db.insertInto('route')
                    .values({
                        name: he.decode(route.TROUTE?.route_name).trim(),
                        sector_id: sectorId,
                        grade_yds: route.TTECH_GRADE?.tech_grade.trim(),
                        climb_style: route.TROUTE_TYPE?.route_type.trim(),
                        sort_order: route.TROUTE?.sort_order,
                        bolt_count: route.TROUTE?.number_of_bolts,
                        first_ascent_by: he.decode(route.TROUTE?.first_ascent_name).trim(),
                        first_ascent_date: route.TROUTE?.first_ascent_date,
                        route_built_date: route.TROUTE?.route_set_date,
                        route_length: route.TROUTE?.route_length,
                    })
                    .executeTakeFirst();
                await db.insertInto('external_route_ref')
                    .values({
                        local_id: Number(insertResult.insertId),
                        external_id: route.TROUTE?.route_id.toString(),
                        external_sector_id: externalSectorId,
                        source: "sloper",
                    }).execute();
                insertCount++;
            }
            catch (error: any) {
                if (error.message.includes("route.name")) {
                    //duplicate found, reference it
                    const existingDuplicate = await db.selectFrom("route")
                        .where((eb) => eb.and([
                            eb("route.name", "=", he.decode(route.TROUTE?.route_name).trim()),
                            eb("route.sector_id", "=", sectorId)
                        ]))
                        .select(["route.id", "sector_id", "name", "sort_order"]).executeTakeFirstOrThrow();
                    console.log(`Duplicate Route: ${existingDuplicate.name}`);
                    //see if our duplicate has the same external sector id
                    const existingDupeRef = await db.selectFrom("external_route_ref")
                        .where((eb) => eb.and([
                            eb("local_id", "=", existingDuplicate.id),
                            eb("external_id", "!=", route.TROUTE?.route_id.toString()),
                            eb("external_sector_id", "=", externalSectorId),
                            eb("source", "=", "sloper"),
                        ]))
                        .select(["local_id"]).executeTakeFirstOrThrow();

                    //check and see if the name overlap is coming from the same external sector
                    if (existingDupeRef !== undefined) {
                        //if there's a duplicate 'within' the same external sector, we'll allow it, set a random name, and then sort it all out recursively
                        const insertResult = await db.insertInto('route')
                            .values({
                                name: nanoid(16),
                                sector_id: sectorId,
                                grade_yds: route.TTECH_GRADE?.tech_grade.trim(),
                                climb_style: route.TROUTE_TYPE?.route_type.trim(),
                                sort_order: route.TROUTE?.sort_order,
                                bolt_count: route.TROUTE?.number_of_bolts,
                                first_ascent_by: he.decode(route.TROUTE?.first_ascent_name).trim(),
                                first_ascent_date: route.TROUTE?.first_ascent_date,
                                route_built_date: route.TROUTE?.route_set_date,
                                route_length: route.TROUTE?.route_length,
                            })
                            .executeTakeFirst();
                        let newRouteId: number = 0;
                        if (insertResult.insertId !== null) newRouteId = Number(insertResult.insertId);
                        else throw new Error(`Failed to insert randomly named route while renaming duplicates on route name: ${existingDuplicate.name} with local sectorid ${existingDuplicate.sector_id}`);

                        await db.insertInto('external_route_ref')
                            .values({
                                local_id: newRouteId,
                                external_id: route.TROUTE?.route_id.toString(),
                                external_sector_id: externalSectorId,
                                source: "sloper",
                            }).execute();
                        insertCount++;
                        console.log(`Duplicate route found with shared source sector (inserting): ${existingDuplicate.name} with id ${newRouteId} and sloper id ${route.TROUTE?.route_id.toString()}`)
                        renameDuplicateRoutesInSector(db, existingDuplicate.name, existingDuplicate.sector_id, existingDuplicate.id, existingDuplicate.sort_order, newRouteId, route.TROUTE?.sort_order);
                    } else {
                        await db.insertInto('external_route_ref')
                            .values({
                                local_id: existingDuplicate.id,
                                external_id: route.TROUTE?.route_id.toString(),
                                external_sector_id: externalSectorId,
                                sync_data: 0,
                                source: "sloper",
                            }).execute();
                        dupeCount++;
                        console.log(`Duplicate route found with differing external sectors (referencing): ${he.decode(route.TROUTE?.route_name).trim()} with sloper id ${route.TROUTE?.route_id.toString()}`)
                    }
                }
                else console.error(error.message);
            }
        }
    }
    return [insertCount, updateCount, dupeCount];
}

/* a new route on the same external sector has a name overlap (e.g. "project"). Use the sort_order, if possible, to append "2, etc"
   calls itself recursively if there's further overlaps (>2 routes of the same name) */
async function renameDuplicateRoutesInSector(
    db: Kysely<DB>,
    name: string,
    sector_id: number | null,
    route1_id: number,
    sort_order1: number | null,
    route2_id: number,
    sort_order2: number | null) {

    const newName = getIncrementalName(name);
    let routeIdforNewName = route1_id; let sortOrderforNewName = sort_order1;
    let routeIdforName = route2_id;
    if ((sort_order1 ?? Number.MAX_SAFE_INTEGER) <= (sort_order2 ?? Number.MAX_SAFE_INTEGER)) {
        routeIdforNewName = route2_id; sortOrderforNewName = sort_order2;
        routeIdforName = route1_id;
    }
    console.log(`Renaming route id ${routeIdforNewName} from "${name}" to "${newName}"`);
    try {
        await db.updateTable("route")
            .set({
                name: newName,
            }).where("route.id", "=", routeIdforNewName)
            .execute();
        await db.updateTable("external_route_ref")
            .set({
                forced_name: newName,
            }).where("local_id", "=", routeIdforNewName)
            .execute();
    }
    catch (error: any) {
        if (error.message.includes("route.name")) {
            //we have another duplicate at N+1 🤷‍♂️
            console.log("Rename triggered new conflict");
            const nextDuplicate = await db.selectFrom("route")
                .where((eb) => eb.and([
                    eb("route.name", "=", newName),
                    eb("route.sector_id", "=", sector_id)
                ]))
                .select(["route.id", "sort_order"]).executeTakeFirstOrThrow();

            renameDuplicateRoutesInSector(db, newName, sector_id, routeIdforNewName, sortOrderforNewName, nextDuplicate.id, nextDuplicate.sort_order);
        }
        else console.error(`Error resolving duplicate route names in sectorid ${sector_id}. Failed to update route "${name}" to "${newName}" with error: ${error.message}`);
    }
    try {
        await db.updateTable("route")
            .set({
                name: name,
            }).where("route.id", "=", routeIdforName)
            .execute();
        await db.updateTable("external_route_ref")
            .set({
                forced_name: name,
            }).where("local_id", "=", routeIdforName)
            .execute();
        console.log(`Rename of id ${routeIdforName} to "${name}" and id ${routeIdforNewName} to "${newName}" successful with no conflicts`);
    } catch (error: any) {
        console.error(`Error renaming lower sorting route id ${routeIdforName} to "${name}" after renaming overlapping route`);
    }
}

function getIncrementalName(input: string): string {
    const regex = /^(.*?)( \d+)?$/;
    const match = input.match(regex);
    if (match) {
        const base = match[1];
        const number = match[2] ? parseInt(match[2]) : null;

        if (number === null) {
            return `${base} 2`;
        } else {
            return `${base} ${number + 1}`;
        }
    }
    return `${input} 2`;
}

async function cleanupEmpties(context: AppLoadContext) {
    const db = getDB(context);

    let result = await db.deleteFrom("external_sector_ref")
        .where("local_id", "in",
            db.selectFrom("sector")
                .select("sector.id")
                .leftJoin('route', 'sector.id', 'route.sector_id')
                .where('route.sector_id', 'is', null))
        .executeTakeFirst();
    console.log(`Deleted ${result.numDeletedRows} empty sector Refs`);

    result = await db.deleteFrom("sector")
        .where("id", "in",
            db.selectFrom("sector")
                .select('sector.id')
                .leftJoin('route', 'sector.id', 'route.sector_id')
                .where('route.sector_id', 'is', null))
        .executeTakeFirst();
    console.log(`Deleted ${result.numDeletedRows} empty Sectors`);

    result = await db.deleteFrom("external_crag_ref")
        .where("local_id", "in",
            db.selectFrom("crag")
                .select("crag.id")
                .leftJoin('sector', 'crag.id', 'sector.crag_id')
                .where('sector.crag_id', 'is', null))
        .executeTakeFirst();
    console.log(`Deleted ${result.numDeletedRows} empty crag Refs`);

    result = await db.deleteFrom("crag")
        .where("id", "in",
            db.selectFrom("crag")
                .select('crag.id')
                .leftJoin('sector', 'crag.id', 'sector.crag_id')
                .where('sector.crag_id', 'is', null))
        .executeTakeFirst();
    console.log(`Deleted ${result.numDeletedRows} empty Crags`);
}

export type SyncedSector = {
    external_id: string; local_id: number; name: string;
};

export type SloperSyncResult = {
    log?: string[];
    sectorList?: SyncedSector[];
    syncCount?: number;
    sectorId?: string;
}

export async function syncSloperCragsAndSectors(context: AppLoadContext, bookIndex: number): Promise<SloperSyncResult> {
    clearLogMessages();
    let sectors: SyncedSector[] = [];
    try {
        const bookId = SLOPER_GUIDEBOOKS[bookIndex];
        if (!bookId) return { log: ["Error: invalid book id"] };

        const cragResponse = await getSloperData<any>(context, SLOPER_CRAGS_PATH + `&guidebookId=${bookId}`);
        const [insertedCrags, updatedCrags, dupeCrags] = await updateCrags(context, cragResponse.data);
        console.log(`Sloper: ${updatedCrags} crags updated. ${insertedCrags} crags added. Found ${dupeCrags} duplicates`);

        //need to fix authz for sectors, until then, we'll get the basics from the crag data
        const [insertedSectors, updatedSectors, dupeSectors] = await updateSectorsTemp(context, cragResponse.data);
        console.log(`Sloper: ${updatedSectors} sectors updated. ${insertedSectors} sectors added. Found ${dupeSectors} duplicates`);
        const result = await getDB(context).selectFrom("external_sector_ref")
            .innerJoin("sector", "external_sector_ref.local_id", "sector.id")
            .select(['external_id', 'local_id', 'sector.name'])
            .where((eb) => eb.and([
                eb('external_sector_ref.sync_children', '=', 1),
                eb('external_sector_ref.source', '=', 'sloper')]))
            .execute();
        sectors = result as SyncedSector[];
    }
    catch (error) {
        console.error(`Error syncing sloper data: ${error}`);
    }
    return { log: getLogMessages(), sectorList: sectors };
}

export async function syncSloperRoutes(context: AppLoadContext, sectorId: number, externalSectorId: string): Promise<SloperSyncResult> {
    clearLogMessages();
    try {
        const [insertedRoutes, updatedRoutes, dupeRoutes] = await updateRoutes(context, externalSectorId, sectorId);
        console.log(`Sloper: ${updatedRoutes} routes updated. ${insertedRoutes} routes added. Found ${dupeRoutes} duplicates`);
        return { log: getLogMessages(), syncCount: insertedRoutes + updatedRoutes };
    } catch (error) {
        console.error(`Error syncing routes for sloper sector id ${externalSectorId}: ${error}`);
    }
    return { log: getLogMessages(), syncCount: 0 };
}

export async function syncSloperIssues(context: AppLoadContext): Promise<SloperSyncResult> {
    cleanupEmpties(context);
    clearLogMessages();
    let insertCount = 0, updateCount = 0;
    try {
        const db = getDB(context);
        const issuesResponse = await getSloperData<any>(context, SLOPER_ISSUES_PATH, "POST");
        for (const issue of issuesResponse.data) {
            const routeRef = await db.selectFrom("external_route_ref")
                .where((eb) => eb.and([
                    eb("external_id", "=", issue.route_id),
                    eb("source", "=", "sloper"),
                ]))
                .select('local_id').executeTakeFirst();
            if (routeRef === undefined) {
                console.error(`No external route reference found for route ${issue.route_name} (${issue.route_id}) in issue ${issue.issue_id}`);
                continue;
            } else if (routeRef.local_id == null) {
                console.log(`Skipping issue id ${issue.issue_id}: route sync on this route (${issue.issue_id}) is disabled (null)`);
                continue;
            }
            const issueRef = await db.selectFrom("external_issue_ref")
                .where((eb) => eb.and([
                    eb("external_id", '=', issue.issue_id.toString()),
                    eb("source", "=", "sloper")
                ]))
                .select(["local_id", "sync_data"]).executeTakeFirst();
            const localIssue: Partial<Issue> = importSloperIssueMetadata(issue);
            if (issueRef !== undefined) {
                if (!issueRef.sync_data || issueRef.local_id == null) continue;
                try {
                    await db.updateTable("issue")
                        .set({
                            route_id: routeRef.local_id,
                            issue_type: localIssue.issue_type,
                            sub_issue_type: localIssue.sub_issue_type,
                            status: localIssue.status,
                            description: localIssue.description,
                            is_flagged: localIssue.is_flagged,
                            flagged_message: localIssue.flagged_message,
                            bolts_affected: localIssue.bolts_affected,
                            reported_by: localIssue.reported_by,
                            reported_at: localIssue.reported_at,
                            last_modified: localIssue.last_modified,
                        }).
                        where("issue.id", "=", issueRef.local_id).executeTakeFirstOrThrow();
                    updateCount++;
                }
                catch (error: any) {
                    console.error(`Update failed syncing sloper issue (${issue.issue_id}) to existing local issue (${localIssue.id}) with error: ${error.message}`);
                    continue;
                }
            }
            else {
                try {
                    const insertResponse = await db.insertInto("issue")
                        .values({
                            route_id: routeRef.local_id,
                            issue_type: localIssue.issue_type ?? "",
                            sub_issue_type: localIssue.sub_issue_type,
                            status: localIssue.status ?? "",
                            description: localIssue.description,
                            is_flagged: localIssue.is_flagged,
                            flagged_message: localIssue.flagged_message,
                            bolts_affected: localIssue.bolts_affected,
                            reported_by: localIssue.reported_by,
                            reported_at: localIssue.reported_at,
                            last_modified: localIssue.last_modified,
                        }).executeTakeFirstOrThrow();
                    await db.insertInto("external_issue_ref")
                        .values({
                            local_id: Number(insertResponse.insertId),
                            external_id: issue.issue_id,
                            external_route_id: issue.route_id,
                            source: "sloper",
                        }).executeTakeFirstOrThrow();
                    insertCount++;
                }
                catch (error: any) {
                    console.error(`Inserts failed syncing sloper issue (${issue.issue_id}) with error: ${error.message}`);
                }
            }
        }
        console.log(`Sloper: ${updateCount} issues updated. ${insertCount} issues added.`);
    }
    catch (error: any) {
        console.log(`Error syncing issues: ${error.message}`);
    }
    return { log: getLogMessages() };
}