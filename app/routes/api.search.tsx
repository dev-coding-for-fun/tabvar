import { LoaderFunction, json } from '@remix-run/cloudflare'; // assuming Remix is being used
import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { Env } from '~/lib/db';
import { DB } from 'kysely-codegen';
import { SearchRoutesResponse } from '../components/routeSearchBox';

export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') + '*';
    const env = context.cloudflare.env as unknown as Env;
    const { DB } = env;

    if (!query) {
        return new Response(JSON.stringify({ routes: [] }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400
        });
    }

    const db = new Kysely<DB>({
        dialect: new D1Dialect({ database: DB }),
    });

    const routes = await db.selectFrom('route_search')
        .where(sql`route_search`, 'match', query)
        .select([sql<number>`rowid`.as('id'), 'name', 'sector_name', 'crag_name'])
        .limit(10)
        .execute();

    const response: SearchRoutesResponse = { routes };

    return json(response);
}
