import { getDB } from "./db";
import { sql } from "kysely";
import type { Route } from "./models";

interface RouteResponse {
    success: boolean;
    error?: string;
}

export async function createRoute(context: any, route: Partial<Route>): Promise<RouteResponse> {
    try {
        const db = getDB(context);

        if (!route.sectorId || !route.name) {
            return { success: false, error: "Missing required fields" };
        }

        await db.insertInto('route')
            .values({
                name: route.name!,
                sector_id: route.sectorId!,
                grade_yds: route.gradeYds || null,
                climb_style: route.climbStyle || null,
                bolt_count: route.boltCount,
                route_length: route.routeLength,
                first_ascent_by: route.firstAscentBy,
                pitch_count: route.pitchCount,
            })
            .execute();

        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to create route" };
    }
}

export async function updateRoute(context: any, route: Partial<Route>): Promise<RouteResponse> {
    try {
        const db = getDB(context);

        if (!route.id || !route.name) {
            return { success: false, error: "Missing required fields" };
        }

        await db.updateTable('route')
            .set({
                name: route.name,
                grade_yds: route.gradeYds || null,
                climb_style: route.climbStyle || null,
                bolt_count: route.boltCount,
                route_length: route.routeLength,
                first_ascent_by: route.firstAscentBy,
                pitch_count: route.pitchCount
            })
            .where('id', '=', route.id)
            .execute();

        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to update route" };
    }
}

export async function updateRouteOrder(context: any, sectorId: number, routes: { id: number, sortOrder: number }[]): Promise<RouteResponse> {
    try {
        const db = getDB(context);

        if (!sectorId || !routes.length) {
            return { success: false, error: "Missing required fields" };
          }
        // Update each route's sort order
        await Promise.all(routes.map(({ id, sortOrder }) =>
            db.updateTable('route')
                .set({ sort_order: sortOrder })
                .where('id', '=', id)
                .execute()
        ));

        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to update route order" };
    }
}

export async function deleteRoute(context: any, routeId: number): Promise<RouteResponse> {
    try {
        const db = getDB(context);
        
        if (!routeId) {
            return { success: false, error: "Missing route id" };
        }

        await db.deleteFrom('route')
            .where('id', '=', routeId)
            .execute();

        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to delete route" };
    }
} 