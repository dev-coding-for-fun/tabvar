import { LoaderFunction } from '@remix-run/cloudflare'; // assuming Remix is being used
import { sql } from 'kysely';
import { getDB } from '~/lib/db';
import { IssueWithDetails } from '~/lib/models';


export const loader: LoaderFunction = async ({ request, context }) => {
    const url = new URL(request.url);
    const cragId: number = +(url.searchParams.get('cragid') ?? 0);
    if (!cragId) {
        throw new Response("Crag ID is required", { status: 400 });
    }
    const db = getDB(context);
    const issues : IssueWithDetails[] = await db
        .selectFrom('issue')
        .innerJoin('route', 'issue.route_id', 'route.id')
        .innerJoin('sector', 'route.sector_id', 'sector.id')
        .innerJoin('crag', 'sector.crag_id', 'crag.id')
        .where('crag.id', '=', cragId)
        .select([
            'issue.id',
            'issue.route_id as routeId',
            'route.name as routeName',
            'route.sector_name as sectorName',
            'route.crag_name as cragName',
            'issue.issue_type as issueType',
            'issue.sub_issue_type as subIssueType',
            'issue.description',
            sql<boolean>`CAST(issue.is_flagged AS BOOLEAN)`.as('isFlagged'),
            'issue.flagged_message as flaggedMessage',
            'issue.status'])
        .execute();
    return issues;
};