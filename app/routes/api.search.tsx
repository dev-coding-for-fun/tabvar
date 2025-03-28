import { LoaderFunction } from '@remix-run/cloudflare'; // assuming Remix is being used
import { sql } from 'kysely';
import { getDB } from '~/lib/db';
import { RouteSearch } from '~/lib/db.d';

export interface RouteSearchResults extends RouteSearch {
    id: number;
    type: string;
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const separateRouteCragSector = url.searchParams.get('separateRouteCragSector') === 'true';
    const routeOnly = url.searchParams.get('routeOnly') === 'true';
    const limit: number = Number(url.searchParams.get('limit')) || 10;
    const query = url.searchParams.get('query')?.replace(/[^a-zA-Z0-9\s]/g, '') || null;
    if (!query) {
        return new Response(JSON.stringify({ routes: [] }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400
        });
    }
    console.log(query);
    const db = getDB(context);

    if (separateRouteCragSector) {
        const results: RouteSearchResults[] = await db.selectFrom('route_search')
            .distinct()
            .where(sql`route_search`, 'match', `crag_name:${query}*`)
            .select([
                sql<number>`NULL`.as('id'),
                sql<string>`'crag'`.as('type'),
                sql<string>`''`.as('name'),
                sql<string>`NULL`.as('sector_name'),
                'crag_name',
                sql<string>`NULL`.as('grade_yds'),
                sql<string>`NULL`.as('bolt_count'),
                sql<string>`NULL`.as('pitch_count')
            ])
            .unionAll(
                db.selectFrom('route_search')
                    .distinct()
                    .where(sql`route_search`, 'match', `sector_name:${query}*`)
                    .select([
                        sql<number>`NULL`.as('id'),
                        sql<string>`'sector'`.as('type'),
                        sql<string>`''`.as('name'),
                        sql<string>`sector_name`.as('sector_name'),
                        sql<string>`crag_name`.as('crag_name'),
                        sql<string>`NULL`.as('grade_yds'),
                        sql<string>`NULL`.as('bolt_count'),
                        sql<string>`NULL`.as('pitch_count')
                    ])) 
            .unionAll(
                db.selectFrom('route_search')
                    .where(sql`route_search`, 'match', `name:${query}*`)
                    .select([
                        sql<number>`rowid`.as('id'),
                        sql<string>`'route'`.as('type'),
                        sql<string>`name`.as('name'),
                        sql<string>`sector_name`.as('sector_name'),
                        sql<string>`crag_name`.as('crag_name'),
                        sql<string>`grade_yds`.as('grade_yds'),
                        sql<string>`bolt_count`.as('bolt_count'),
                        sql<string>`pitch_count`.as('pitch_count')
                    ])
            ) 
            .limit(limit)
            .execute();
        console.log(results);
        return results;
    }
    else if (routeOnly) {
        const routes: RouteSearchResults[] = await db.selectFrom('route_search')
            .where(sql`route_search`, 'match', `name:${query}*`)
            .select([sql<number>`rowid`.as('id'),
                'name',
                sql<string>`'route'`.as('type'),
                'sector_name',
                'crag_name',
                'grade_yds',
                'bolt_count',
                'pitch_count'
            ])
            .limit(limit)
            .execute();
        return routes;
    }
    else {
        const routes: RouteSearchResults[] = await db.selectFrom('route_search')
            .where(sql`route_search`, 'match', `"${query}" *`)
            .select([sql<number>`rowid`.as('id'),
                'name',
                sql<string>`'route'`.as('type'),
                'sector_name',
                'crag_name',
                'grade_yds',
                'bolt_count',
                'pitch_count'
            ])
            .limit(limit)
            .execute();
        return routes;
    }
}
