import { ActionFunction } from '@remix-run/cloudflare';
import { getDB } from '~/lib/db';
import { RouteSearchResults } from '~/lib/models';

export const action: ActionFunction = async ({ request, context }) => {
    const formData = await request.formData();
    const routeId = formData.get('routeId');

    if (!routeId) {
        return new Response(JSON.stringify({ error: 'routeId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const db = getDB(context);

    const route = await db
        .selectFrom('route')
        .leftJoin('sector', 'route.sector_id', 'sector.id')
        .leftJoin('crag', 'route.crag_id', 'crag.id')
        .where('route.id', '=', Number(routeId))
        .select([
            'route.id as routeId',
            'route.sector_id as sectorId',
            'route.crag_id as cragId',
            'route.name as routeName',
            'route.alt_names as routeAltNames',
            'sector.name as sectorName',
            'crag.name as cragName',
            'route.grade_yds as gradeYds',
            'route.bolt_count as boltCount',
            'route.pitch_count as pitchCount'
        ])
        .executeTakeFirst();

    if (!route) {
        return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const result: RouteSearchResults = {
        routeId: route.routeId,
        sectorId: route.sectorId,
        cragId: route.cragId,
        type: 'route',
        routeName: route.routeName,
        routeAltNames: route.routeAltNames,
        sectorName: route.sectorName,
        cragName: route.cragName,
        gradeYds: route.gradeYds,
        boltCount: route.boltCount?.toString() || null,
        pitchCount: route.pitchCount?.toString() || null
    };

    return new Response(JSON.stringify([result]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
