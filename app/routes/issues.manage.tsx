import { ActionIcon, Badge, Button, Center, Container, Group, Text, rem } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { useLoaderData, Fetcher, useFetcher } from "@remix-run/react";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { authenticator } from "~/lib/auth.server";
import { IconArchive, IconArrowBack, IconCheck, IconClick, IconEdit, IconFlag, IconRubberStamp } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { IssueWithRoute } from "./issues._index";
import { useState } from "react";

const PAGE_SIZE = 15;

const StatusActions: React.FC<{ status: string, lastStatus: string | null, onStatusChange: (newStatus: string) => void }> = ({ status, lastStatus, onStatusChange }) => {
    switch (status) {
      case "In Moderation":
        return (
          <Group gap="xs">
            <Button size="compact-xs" leftSection={<IconRubberStamp style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Reported")}>Accept</Button>
            <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Archived")}>Delete</Button>
          </Group>
        );
      case "Reported":
      case "Viewed":
        return (
          <Group gap={4} justify="right" wrap="nowrap">
            <Button size="compact-xs" leftSection={<IconCheck style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Completed")}>Complete</Button>
            <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Archived")}>Delete</Button>
          </Group>
        );
      case "Completed":
        return (
          <Group gap="xs">
            <Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Reported")}>Revert</Button>
            <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange("Archived")}>Delete</Button>
          </Group>
        );
      case "Archived":
        return lastStatus ? (
          <Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => onStatusChange(lastStatus)}>Restore to {lastStatus}</Button>
        ) : null;
      default:
        return null;
    }
  };

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
    const issues = useLoaderData<IssueWithRoute[]>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<IssueWithRoute>();

    const handleStatusChange = (newStatus: string) => {
        console.log(`changing status to ${newStatus}`);
    }

    const renderActions: DataTableColumn<IssueWithRoute>['render'] = (record: IssueWithRoute) => (
        <Group gap={4} justify="right" wrap="nowrap">
                  <StatusActions 
                            status={record.status} 
                            lastStatus={record.last_status} 
                            onStatusChange={handleStatusChange}
                        /> 
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
                    records={issues as IssueWithRoute[]}
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
                                <Badge size="md" color={`status-${record.status.toLowerCase().replace(" ", "-")}`}>{record.status}</Badge>,
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
