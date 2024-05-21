import { LoaderFunction, json } from '@remix-run/cloudflare'; // assuming Remix is being used
import { sql } from 'kysely';
import { getDB } from '~/lib/db';
import { RouteSearch } from 'kysely-codegen';

export interface RouteSearchResults extends RouteSearch {
    id: number;
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') + '*';

    if (!query) {
        return new Response(JSON.stringify({ routes: [] }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400
        });
    }

    const db = getDB(context);

    const routes = await db.selectFrom('route_search')
        .where(sql`route_search`, 'match', query)
        .select([sql<number>`rowid`.as('id'), 
            'name', 
            'sector_name', 
            'crag_name', 
            'grade_yds', 
            'bolt_count', 
            'pitch_count'
        ])
        .limit(10)
        .execute();

    const response: RouteSearchResults[] = routes;

    return json(response);
}
