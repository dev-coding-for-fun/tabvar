import { Badge, Box, Button, Center, Container, Group, Text, rem } from "@mantine/core";
import { ActionFunction, LoaderFunction, json } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { authenticator } from "~/lib/auth.server";
import { IconArchive, IconArrowBack, IconCheck, IconClick, IconEdit, IconRubberStamp } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { IssueWithRoute } from "./issues._index";
import { useEffect, useRef, useState } from "react";

const StatusActions: React.FC<{
    status: string,
    lastStatus: string | null,
    issueId: number,
}> = ({ status, lastStatus, issueId }) => {
    const fetcher = useFetcher();

    const handleStatusChange = (action: string) => {
        const formData = new FormData();
        formData.append("action", action);
        formData.append("issueId", issueId.toString());
        formData.append("lastStatus", lastStatus ?? "");
        formData.append("status", status);
        fetcher.submit(formData, { method: "post" });
    };

    switch (status) {
        case "In Moderation":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Button size="compact-xs" leftSection={<IconRubberStamp style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("accept")}>Accept</Button>
                    <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("archive")}>Delete</Button>
                </Group>
            );
        case "Reported":
        case "Viewed":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Button size="compact-xs" leftSection={<IconCheck style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("complete")}>Done</Button>
                    <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("archive")}>Delete</Button>
                </Group>
            );
        case "Completed":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("revert")}>Revert</Button>
                    <Button size="compact-xs" leftSection={<IconArchive style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("archive")}>Delete</Button>
                </Group>
            );
        case "Archived":
            return (
                <Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("restore")}>Restore to {lastStatus}</Button>
            );
        default:
            return (<Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("restore")}>Fix Status</Button>);
    }
};

export const action: ActionFunction = async ({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    const formData = await request.formData();
    const action = formData.get("action");
    const status = formData.get("status")?.toString() ?? "";
    const issueId = Number(formData.get("issueId"));
    const db = getDB(context);
    if (issueId) {
        switch (action) {
            case "updateIssue": {
                const issueType = formData.get("issueType")?.toString();
            const subIssueType = formData.get("subIssueType")?.toString();
            const description = formData.get("description")?.toString();
            const isFlagged = formData.get("isFlagged") === "on";
            const safetyNotice = formData.get("safetyNotice")?.toString();
            try {
                await db.updateTable('issue')
                    .set({
                        issue_type: issueType,
                        sub_issue_type: subIssueType,
                        description: description,
                        is_flagged: isFlagged ? 1 : 0,
                        flagged_message: safetyNotice,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
            } catch (error) {
                console.error('Error updating issue:', error);
                return json({ success: false, message: 'Failed to update issue' }, { status: 500 });
            }
                break;
            }
            case "accept":
                await db.updateTable('issue')
                    .set({
                        status: "Reported",
                        last_status: status,
                        approved_at: new Date().toISOString(),
                        approved_by_uid: user.uid,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
                break;
            case "archive":
                await db.updateTable('issue')
                    .set({
                        status: "Archived",
                        last_status: status,
                        archived_at: new Date().toISOString(),
                        archived_by_uid: user.uid,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
                break;
            case "complete":
                await db.updateTable('issue')
                    .set({
                        status: "Completed",
                        last_status: status,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
                break;
            case "revert":
                await db.updateTable('issue')
                    .set({
                        status: "Reported",
                        last_status: status,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
                break;
            case "restore": {
                const newStatus = formData.get("lastStatus") ? formData.get("lastStatus")?.toString() : "Reported";
                await db.updateTable('issue')
                    .set({
                        status: newStatus,
                        last_status: status,
                        last_modified: new Date().toISOString(),
                    })
                    .where('id', '=', issueId)
                    .execute();
                break;
            }
            default:
                return json({success: false, message: 'Invalid action'}, { status: 400 });
        }
    }
    return json({ success: true });
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
            'route.name as route_name',
            'route.sector_name',
            'route.crag_name',
            'issue_type',
            'sub_issue_type',
            'issue.status',
            'issue.last_status',
            'description',
            'bolts_affected',
        ])
        .execute();
    return json(result);
}

const TruncatableDescription: React.FC<{ description: string }> = ({ description }) => {
    const [expanded, setExpanded] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!textRef.current) return;

        const checkTruncation = () => {
            const element = textRef.current;
            if (element) {
                setIsTruncated(
                    element.scrollHeight > element.clientHeight ||
                    element.scrollWidth > element.clientWidth
                );
            }
        };

        const resizeObserver = new ResizeObserver(checkTruncation);
        resizeObserver.observe(textRef.current);

        return () => resizeObserver.disconnect();
    }, []);

    const toggleExpanded = () => setExpanded(!expanded);

    return (
        <Box>
            <Text
                ref={textRef}
                lineClamp={expanded ? undefined : 3}
                mb={4}
            >
                {description}
            </Text>
            {isTruncated && (
                <Button size="compact-xs" variant="subtle" onClick={toggleExpanded}>
                    {expanded ? 'Show less' : 'Show more'}
                </Button>
            )}
        </Box>
    );
};

export default function IssuesIndex() {
    const issues = useLoaderData<IssueWithRoute[]>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<IssueWithRoute>();

    const renderActions: DataTableColumn<IssueWithRoute>['render'] = (record: IssueWithRoute) => (
        <Group gap={4} justify="right" wrap="nowrap">
            <StatusActions
                status={record.status}
                lastStatus={record.last_status}
                issueId={Number(record.id)} 
            />
            <Button
                size="compact-xs"
                leftSection={<IconEdit style={{ width: rem(14), height: rem(14) }} />}
                onClick={() => {
                    setOpenIssue(record);
                    open();
                }}
            >
                Edit
            </Button>


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
                                    <Group gap={4} wrap="nowrap">
                                        <Badge size="xs" color="sector-color">{record.sector_name}</Badge>
                                        <Badge size="xs" color="crag-color">{record.crag_name}</Badge>
                                    </Group>
                                </Group>
                        },
                        {
                            accessor: "issue_type",
                        },
                        {
                            accessor: "sub_issue_type",
                        },
                        {
                            accessor: "description",
                            render: (record) => <TruncatableDescription description={record.description || ''} />,
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
