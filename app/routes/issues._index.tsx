import { Container } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { Issue } from "kysely-codegen";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { issueTypes, subIssues, subIssuesByType } from "~/lib/constants";
import { authenticator } from "~/lib/auth.server";

const PAGE_SIZE = 15;

export interface IssueWithRoute extends Issue {
    name: string;
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    const db = getDB(context);
    const result = await db.selectFrom('issue')
        .innerJoin('route', 'route.id', 'issue.route_id')
        .select([
            'issue.id',
            'route.name',
            'route.sector_name',
            'route.crag_name',
            'issue_type',
            'sub_issue_type',
            'issue.status',
            'description',
            'issue.created_at',
            'bolts_affected',
        ])
        .execute();
    return json(result);
}

export default function IssuesIndex() {
    let records = useLoaderData<IssueWithRoute[]>();

    return (
        <Container size="xl" p="md">
            <DataTable
                withTableBorder
                borderRadius="sm"
                withColumnBorders
                striped
                highlightOnHover
                records={records}
                columns={[
                    {
                        accessor: "id",
                        textAlign: "right",
                    },
                    {
                        accessor: "name"
                    },
                    {
                        accessor: "issue_type"
                    },
                    {
                        accessor: "sub_issue_type"
                    },
                ]}
            />
        </Container>
    );
}
