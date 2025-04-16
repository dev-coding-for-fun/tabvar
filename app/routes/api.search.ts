import { LoaderFunction } from '@remix-run/cloudflare'; // assuming Remix is being used
import { sql } from 'kysely';
import { getDB } from '~/lib/db';
import { RouteSearchResults } from '~/lib/models';

export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const searchMode = url.searchParams.get('searchMode') || 'global';
    const limit: number = Number(url.searchParams.get('limit')) || 10;
    const query = url.searchParams.get('query')?.replace(/[^a-zA-Z0-9\s]/g, '') || null;
    if (!query) {
        return new Response(JSON.stringify({ error: 'parameter <query> is required' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400
        });
    }
    console.log(query);
    const db = getDB(context);

    let results: RouteSearchResults[] = [];
    switch (searchMode) {
        case 'allObjects':
            results = await db.selectFrom('route_search')
                .distinct()
                .where(sql`route_search`, 'match', `crag_name:${query}*`)
                .select([
                    sql<number>`NULL`.as('routeId'),
                    sql<number>`NULL`.as('sectorId'),
                    sql<number>`crag_id`.as('cragId'),
                    sql<string>`'crag'`.as('type'),
                    sql<string>`NULL`.as('routeName'),
                    sql<string>`NULL`.as('routeAltNames'),
                    sql<string>`NULL`.as('sectorName'),
                    sql<string>`crag_name`.as('cragName'),
                    sql<string>`NULL`.as('gradeYds'),
                    sql<string>`NULL`.as('boltCount'),
                    sql<string>`NULL`.as('pitchCount')
                ])
                .unionAll(
                    db.selectFrom('route_search')
                        .distinct()
                        .where(sql`route_search`, 'match', `sector_name:${query}*`)
                        .select([
                            sql<number>`NULL`.as('routeId'),
                            sql<number>`sector_id`.as('sectorId'),
                            sql<number>`crag_id`.as('cragId'),
                            sql<string>`'sector'`.as('type'),
                            sql<string>`NULL`.as('routeName'),
                            sql<string>`NULL`.as('routeAltNames'),
                            sql<string>`sector_name`.as('sectorName'),
                            sql<string>`crag_name`.as('cragName'),
                            sql<string>`NULL`.as('gradeYds'),
                            sql<string>`NULL`.as('boltCount'),
                            sql<string>`NULL`.as('pitchCount')
                        ]))
                .unionAll(
                    db.selectFrom('route_search')
                        .where(sql`route_search`, 'match', `name:${query}*`)
                        .select([
                            sql<number>`rowid`.as('routeId'),
                            sql<number>`sector_id`.as('sectorId'),
                            sql<number>`crag_id`.as('cragId'),
                            sql<string>`'route'`.as('type'),
                            sql<string>`name`.as('routeName'),
                            sql<string>`alt_names`.as('routeAltNames'),
                            sql<string>`sector_name`.as('sectorName'),
                            sql<string>`crag_name`.as('cragName'),
                            sql<string>`grade_yds`.as('gradeYds'),
                            sql<string>`bolt_count`.as('boltCount'),
                            sql<string>`pitch_count`.as('pitchCount')
                        ])
                )
                .limit(limit)
                .execute();
            return results;
        case 'routesOnly':
            results = await db.selectFrom('route_search')
                .where(sql`route_search`, 'match', `name:${query}*`)
                .select([
                    sql<number>`rowid`.as('routeId'),
                    sql<number>`sector_id`.as('sectorId'),
                    sql<number>`crag_id`.as('cragId'),
                    sql<string>`name`.as('routeName'),
                    sql<string>`alt_names`.as('routeAltNames'),
                    sql<string>`'route'`.as('type'),
                    sql<string>`sector_name`.as('sectorName'),
                    sql<string>`crag_name`.as('cragName'),
                    sql<string>`grade_yds`.as('gradeYds'),
                    sql<string>`bolt_count`.as('boltCount'),
                    sql<string>`pitch_count`.as('pitchCount')
                ])
                .limit(limit)
                .execute();
            return results;

        case 'global':
            results = await db.selectFrom('route_search')
                .where(sql`route_search`, 'match', `"${query}" *`)
                .select([
                    sql<number>`rowid`.as('routeId'),
                    sql<number>`sector_id`.as('sectorId'),
                    sql<number>`crag_id`.as('cragId'),
                    sql<string>`name`.as('routeName'),
                    sql<string>`alt_names`.as('routeAltNames'),
                    sql<string>`'route'`.as('type'),
                    sql<string>`sector_name`.as('sectorName'),
                    sql<string>`crag_name`.as('cragName'),
                    sql<string>`grade_yds`.as('gradeYds'),
                    sql<string>`bolt_count`.as('boltCount'),
                    sql<string>`pitch_count`.as('pitchCount')
                ])
                .limit(limit)
                .execute();
            return results;
        default:
            return new Response(JSON.stringify({ error: 'optional parameter <searchMode> must be one of: allObjects, routesOnly, or global (default)' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
    }
}
