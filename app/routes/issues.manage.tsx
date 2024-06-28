import { ActionIcon, Badge, Center, Container, Group, Modal, Text } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { Issue } from "kysely-codegen";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { authenticator } from "~/lib/auth.server";
import { IconClick, IconEdit, IconRubberStamp } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { IssueWithRoute } from "./issues._index";
import { useState } from "react";

const PAGE_SIZE = 15;

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    }); 
    const db = getDB(context);
    const result = await db.selectFrom('issue')
        .innerJoin('route', 'route.id', 'issue.route_id')
        .select([
            'issue.id',
            'route.name as route_name',
            'route.sector_name',
            'route.crag_name',
            'issue_type',
            'sub_issue_type',
            'issue.status',
            'description',
            'bolts_affected',
        ])
        .execute();
    return json(result);
}

export default function IssuesIndex() {
    const records = useLoaderData<IssueWithRoute[]>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<IssueWithRoute>();


    const renderActions: DataTableColumn<IssueWithRoute>['render'] = (record: IssueWithRoute) => (
        <Group gap={4} justify="right" wrap="nowrap">
            <ActionIcon
                size="sm"
                variant="transparent"
                color="green"
                onClick={(e) => {
                    e.stopPropagation();
                    console.log(`clicked stamp on ${record.id}`);
                }}
            >
                <IconRubberStamp size={16} />
            </ActionIcon>
            <ActionIcon
                size="sm"
                variant="transparent"
                color="blue"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpenIssue(record);
                    open();
                }}
            >
                <IconEdit size={16} />
            </ActionIcon>


        </Group>
    );

    return (
        <div>
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
                            accessor: "route_name",
                            render: (record) =>
                                <Group>
                                    <Text>{record.route_name}</Text>
                                    <Badge size="xs" color="sector-color">{record.sector_name}</Badge>
                                    <Badge size="xs" color="crag-color">{record.crag_name}</Badge>
                                </Group>,
                        },
                        {
                            accessor: "issue_type",
                        },
                        {
                            accessor: "sub_issue_type",
                        },
                        {
                            accessor: "description",
                            render: ({ description }) =>
                                description?.split("\n").map((line, index) => <p key={index}>{line}</p>) || null,
                        },
                        {
                            accessor: "status",
                            render: (record) =>
                                <Badge size="md" color={`status-${record.status}`}>{record.status}</Badge>,
                        },
                        {
                            accessor: "actions",
                            title: (<Center><IconClick size={16} /></Center>),
                            width: '0%',
                            render: renderActions,
                        },
                    ]}

                />
            </Container>
            {openIssue && (
            <IssueDetailsModal
                opened={opened} onClose={close} issue={openIssue}
            />
            )}
        </div>
    );
}
