import { LoaderFunction } from '@remix-run/cloudflare'; // assuming Remix is being used
import { getDB } from '~/lib/db';


export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const cragId: number = +(url.searchParams.get('cragid') ?? 0);
    if (!cragId) {
        throw new Response("Crag ID is required", { status: 400 });
    }
    const db = getDB(context);
    const issues = await db
        .selectFrom('issue')
        .innerJoin('route', 'issue.route_id', 'route.id')
        .innerJoin('sector', 'route.sector_id', 'sector.id')
        .innerJoin('crag', 'sector.crag_id', 'crag.id')
        .where('crag.id', '=', cragId)
        .select([
            'issue.id',
            'route.name as route_name',
            'route.sector_name',
            'route.crag_name',
            'issue_type',
            'sub_issue_type',
            'issue.description',
            'issue.is_flagged',
            'issue.flagged_message',
            'issue.status'])
        .execute();
    return issues;
};