import { LoaderFunction, json } from '@remix-run/cloudflare'; // assuming Remix is being used
import { Kysely, ReferenceExpression, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { Env } from '~/lib/db';
import { DB } from 'kysely-codegen';
import { SearchRoutesResponse } from './_issues.createIssue';
import { SelectExpression } from 'kysely';

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

    //Kysely doesn't fully support FTS5 tables with proper typing, so these refs are a workaround.
    const routeSearchRef = "route_search" as ReferenceExpression<DB, "route_search">;
    const routeSelectRef = ['rowid as id', 'name', 'sector_name', 'route_name'] as SelectExpression<DB, "route_search">[];
    const routes = await db.selectFrom('route_search')
        .select(routeSelectRef)
        .where(routeSearchRef, sql`MATCH`, `${query}`)
        .limit(10)
        .execute();

    const response: SearchRoutesResponse = { routes };

    return json(response);
}
