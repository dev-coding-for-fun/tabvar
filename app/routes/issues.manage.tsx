import { Badge, Box, Button, Center, Container, Group, Text, Image, rem, Modal, Stack, Title, Tooltip, TextInput, ActionIcon, Anchor } from "@mantine/core";
import { ActionFunction, AppLoadContext, LoaderFunction, data } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { getAuthenticator } from "~/lib/auth.server";
import { IconArchive, IconArrowBack, IconCheck, IconClick, IconEdit, IconFileX, IconFlag, IconRubberStamp } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import { PERMISSION_ERROR } from "~/lib/constants";
import { deleteFromR2 } from "~/lib/s3.server";
import { Issue, Route, User, RouteSearchResults } from "~/lib/models";


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
                    <Tooltip label="Accept Issue">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("accept")}
                        >
                            <IconRubberStamp size={20} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("archive")}
                        >
                            <IconArchive size={20} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            );
        case "Reported":
        case "Viewed":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Tooltip label="Mark as Done">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("complete")}
                        >
                            <IconCheck size={20} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("archive")}
                        >
                            <IconArchive size={20} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            );
        case "Completed":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Tooltip label="Revert">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("revert")}
                        >
                            <IconArrowBack size={20} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("archive")}
                        >
                            <IconArchive size={20} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            );
        case "Archived":
            return (
                <Group gap={4} justify="right" wrap="nowrap">
                    <Tooltip label="Restore">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("restore")}
                        >
                            <IconArrowBack size={20} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Destroy">
                        <ActionIcon
                            variant="subtle"
                            color="red"
                            size="lg"
                            onClick={() => handleStatusChange("delete")}
                        >
                            <IconFileX size={20} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            );
        default:
            return (
                <Tooltip label="Fix Status">
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        onClick={() => handleStatusChange("restore")}
                    >
                        <IconArrowBack size={20} />
                    </ActionIcon>
                </Tooltip>
            );
    }
};

async function modifyIssue(context: AppLoadContext, issueId: number, updates: Partial<Issue>, user: User) {
    const db = getDB(context);
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();
    await db.updateTable('issue')
        .set({
            issue_type: updates.issueType,
            sub_issue_type: updates.subIssueType,
            description: updates.description,
            is_flagged: updates.isFlagged ? 1 : 0,
            flagged_message: updates.flaggedMessage,
            last_modified: new Date().toISOString(),
        })
        .where('id', '=', issueId)
        .execute();
    await db.insertInto('issue_audit_log')
        .values({
            issue_id: issueId,
            action: "update",
            uid: user.uid,
            user_display_name: user.displayName,
            user_role: user.role,
            before_issue_type: issue.issue_type,
            after_issue_type: updates.issueType,
            before_sub_issue_type: issue.sub_issue_type,
            after_sub_issue_type: updates.subIssueType,
            before_description: issue.description,
            after_description: updates.description,
            before_is_flagged: issue.is_flagged,
            after_is_flagged: updates.isFlagged ? 1 : 0,
            before_flagged_message: issue.flagged_message,
            after_flagged_message: updates.flaggedMessage,

        })
        .execute();
}

async function modifyIssueStatus(context: AppLoadContext, issueId: number, updates: Partial<Omit<Issue, "id" | "created_at">>, user: User) {
    const db = getDB(context);
    // Fetch the current issue state *before* updating for the audit log
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();

    await db.updateTable('issue')
        .set({
            status: updates.status,
            last_status: updates.lastStatus,
            approved_at: updates.approvedAt,
            approved_by_uid: updates.approvedByUid,
            archived_at: updates.archivedAt,
            archived_by_uid: updates.archivedByUid,
            last_modified: new Date().toISOString(),
        })
        .where('id', '=', issueId)
        .execute();

    await db.insertInto('issue_audit_log')
        .values({
            issue_id: issueId,
            action: "update",
            uid: user.uid,
            user_display_name: user.displayName,
            user_role: user.role,
            before_status: issue.status,
            after_status: updates.status,
        }).execute();
}

async function deleteIssue(context: AppLoadContext, issueId: number, user: User) {
    const db = getDB(context);
    const env = context.cloudflare.env as unknown as Env;
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();
    const attachments = await db.selectFrom('issue_attachment')
        .select(['url', 'name'])
        .where('issue_id', '=', issueId).execute();
    if (attachments.length > 0) {
        for (const attachment of attachments) {
            const fileName = attachment.name ?? attachment.url.split('/').pop();
            if (!fileName) { throw new Error('Invalid attachment filename'); }
            await deleteFromR2(context, env.ISSUES_BUCKET_NAME, fileName);
        }
    }
    await db.deleteFrom('issue_attachment')
        .where('issue_attachment.issue_id', '=', issueId)
        .execute();
    await db.deleteFrom('external_issue_ref')
        .where('external_issue_ref.local_id', '=', issueId)
        .execute();
    await db.deleteFrom('issue')
        .where('issue.id', '=', issueId)
        .execute();
    await db.insertInto('issue_audit_log')
        .values({
            issue_id: issueId,
            action: "delete",
            uid: user.uid,
            user_display_name: user.displayName,
            user_role: user.role,
            before_bolts_affected: issue.bolts_affected,
            before_description: issue.description,
            before_is_flagged: issue.is_flagged,
            before_flagged_message: issue.flagged_message,
            before_issue_type: issue.issue_type,
            before_route_id: issue.route_id,
            before_status: issue.status,
            before_sub_issue_type: issue.sub_issue_type,
        })
        .execute();
}

export const action: ActionFunction = async ({ request, context }) => {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin' && user.role !== 'member') {
        return data({ error: PERMISSION_ERROR }, { status: 403 });
    }
    const formData = await request.formData();
    const action = formData.get("action");
    const status = formData.get("status")?.toString() ?? "";
    const issueId = Number(formData.get("issueId"));
    if (issueId) {
        switch (action) {
            case "updateIssue": {
                const issueUpdates: Partial<Issue> = {
                    issueType: formData.get("issueType")?.toString(),
                    subIssueType: formData.get("subIssueType")?.toString(),
                    description: formData.get("description")?.toString(),
                    isFlagged: formData.get("isFlagged") === "on" ? true : false,
                    flaggedMessage: formData.get("safetyNotice")?.toString(),
                };

                try {
                    modifyIssue(context, issueId, issueUpdates, user);
                    return data({ success: true, message: 'Issue updated' });
                } catch (error) {
                    console.error('Error updating issue:', error);
                    return data({ success: false, message: 'Failed to update issue' }, { status: 500 });
                }
                break;
            }
            case "accept":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Reported",
                            lastStatus: status,
                            approvedAt: new Date().toISOString(),
                            approvedByUid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }

                break;
            case "archive":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Archived",
                            lastStatus: status,
                            archivedAt: new Date().toISOString(),
                            archivedByUid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "complete":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Completed",
                            lastStatus: status,
                            archivedAt: new Date().toISOString(),
                            archivedByUid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "revert":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Reported",
                            lastStatus: status,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "restore": {
                try {
                    const newStatus = formData.get("lastStatus") ? formData.get("lastStatus")?.toString() : "Reported";
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: newStatus,
                            lastStatus: status,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            }
            case "delete": {
                if (user.role == 'admin') {
                    try {
                        deleteIssue(context, issueId, user);
                    } catch (error) {
                        console.error('Error updating issue status:', error);
                        return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                    }
                }
                else return data({ success: false, message: 'Admin role required to permanently delete issues' }, { status: 403 });
                break;

            }
            default:
                return data({ success: false, message: 'Invalid action' }, { status: 400 });
        }
    }
    return { success: true };
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return data({ issues: [], error: PERMISSION_ERROR }, { status: 403 });
    }
    const db = getDB(context);
    const result = await db.selectFrom('issue')
        .innerJoin('route', 'route.id', 'issue.route_id')
        .leftJoin('issue_attachment', 'issue_attachment.issue_id', 'issue.id')
        .select([
            'issue.id',
            'issue.route_id',
            'route.name as route_name',
            'route.sector_name',
            'route.crag_name',
            'issue_type',
            'sub_issue_type',
            'issue.status',
            'issue.last_status',
            'description',
            'is_flagged',
            'flagged_message',
            'bolts_affected',
            'issue_attachment.id as attachment_id',
            'issue_attachment.url',
            'issue_attachment.name as attachment_name',
            'issue.created_at'
        ])
        .execute();

    const issues: Issue[] = result.map((row) => {
        const route: Route = {
            id: row.route_id,
            name: row.route_name,
            sectorName: row.sector_name ?? "",
            cragName: row.crag_name ?? "",
        } as Route;
        return {
            id: Number(row.id),
            routeId: row.route_id,
            route,
            issueType: row.issue_type,
            subIssueType: row.sub_issue_type,
            status: row.status,
            lastStatus: row.last_status ?? undefined,
            description: row.description ?? undefined,
            isFlagged: Boolean(row.is_flagged),
            flaggedMessage: row.flagged_message ?? undefined,
            boltsAffected: row.bolts_affected ?? undefined,
            createdAt: row.created_at ?? "",
            attachments: row.url && row.attachment_name && row.attachment_id ? [{
                id: row.attachment_id,
                issueId: row.id,
                url: row.url,
                type: "image",
                name: row.attachment_name
            }] : []
        } as Issue;
    });

    return {
        issues,
        user
    };
}

const TruncatableDescription: React.FC<{ description: string, fz: string }> = ({ description, fz }) => {
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
                fz={fz}
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

export default function IssuesManager() {
    const { issues, user } = useLoaderData<{ issues: Issue[]; user: User; }>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<Issue>();
    const [selectedResult, setSelectedResult] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredIssues, setFilteredIssues] = useState<Issue[]>(issues);
    const searchFetcher = useFetcher<RouteSearchResults[]>();
    const [imageOverlay, setImageOverlay] = useState<{ isOpen: boolean; url: string }>({
        isOpen: false,
        url: "",
    });
    const fz = "sm";

    // Effect to handle search results and filter issues
    useEffect(() => {
        if (searchFetcher.data && searchQuery.length > 1) {
            const searchResults = searchFetcher.data;
            const matchingIssues = issues.filter(issue => 
                searchResults.some(route => issue.routeId === route.routeId)
            );
            setFilteredIssues(matchingIssues);
        } else if (searchQuery.length <= 1) {
            setFilteredIssues(issues);
        }
    }, [searchFetcher.data, searchQuery, issues]);

    const renderActions: DataTableColumn<Issue>['render'] = (record: Issue) => (
        <Group gap={4} justify="right" wrap="nowrap">
            <StatusActions
                status={record.status}
                lastStatus={record.lastStatus ?? null}
                issueId={Number(record.id)}
            />
            <Tooltip label="Edit">
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="lg"
                    onClick={() => {
                        setOpenIssue(record);
                        open();
                    }}
                >
                    <IconEdit size={20} />
                </ActionIcon>
            </Tooltip>
        </Group>
    );

    function handleSearchChange(selected: { value: string | null; boltCount: number | null; }): void {
        throw new Error("Function not implemented.");
    }

    return (
        <Container size="xl">
            <Stack>
                <Group gap="xs" mb="md" align="center">
                    <Title id="title" order={1}>Route Issues</Title>
                    <Anchor component={Link} to="/topos" ml="md">
                        🗺️ Climbing Areas
                    </Anchor>
                </Group>
                <Stack gap="xs">
                    <Link to={`/issues/create`}>➕ Submit New Issue</Link>
                    {(user.role === 'admin' || user.role === "member") && (
                        <Link to={`/issues/`}>🔍 Explore Issues</Link>
                    )}
                </Stack>

                <TextInput
                    placeholder="Filter by route, sector, or crag..."
                    value={searchQuery}
                    onChange={(event) => {
                        const query = event.currentTarget.value;
                        setSearchQuery(query);
                        if (query.length > 1) {
                            searchFetcher.load(`/api/search?query=${encodeURIComponent(query)}&limit=500`);
                        } else {
                            setFilteredIssues(issues);
                        }
                    }}
                />

                <DataTable<Issue>
                    withTableBorder
                    borderRadius="sm"
                    fz={fz}
                    withColumnBorders
                    striped
                    highlightOnHover
                    records={filteredIssues}
                    columns={[
                        {
                            accessor: "id",
                            textAlign: "right",
                        },
                        {
                            accessor: "route.name",
                            render: (record) =>
                                <Group gap={4}>
                                    {record.isFlagged && (
                                        <Tooltip position="top" withArrow label={record.flaggedMessage} fz={fz}>
                                            <IconFlag fill="red" color="red" />
                                        </Tooltip>)}
                                    <Text fz={fz}>{record.route?.name}</Text>
                                    <Group gap={4} wrap="nowrap">
                                        <Badge size="xs" color="sector-color">{record.route?.sectorName}</Badge>
                                        <Badge size="xs" color="crag-color">{record.route?.cragName}</Badge>
                                    </Group>
                                </Group>
                        },
                        {
                            accessor: "issueType",
                        },
                        {
                            accessor: "subIssueType",
                        },
                        {
                            accessor: "description",
                            render: (record) => <TruncatableDescription fz={fz} description={record.description || ''} />,
                        },
                        {
                            accessor: "Images",
                            render: (record) => (
                                <Group gap={2}>
                                    {record.attachments?.map((attachment) => (
                                        <Image
                                            key={attachment.name}
                                            src={attachment.url}
                                            alt={attachment.name ?? ""}
                                            width={40}
                                            height={40}
                                            fit="contain"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setImageOverlay({ isOpen: true, url: attachment.url ?? "" })}
                                        />
                                    ))}
                                </Group>
                            )
                        },
                        {
                            accessor: "status",
                            render: (record) =>
                                <Badge size="xs" color={`status-${record.status.toLowerCase().replace(" ", "-")}`}>{record.status}</Badge>,
                            width: '114px',
                        },
                        {
                            accessor: "actions",
                            title: (<Center><IconClick size={16} /></Center>),
                            width: '0%',
                            render: renderActions,
                        },
                    ]}

                />
                <a href="#title">🔝 Back to top</a>
            </Stack>
            {openIssue && (
                <IssueDetailsModal
                    opened={opened} onClose={close} issue={openIssue as Issue}
                />
            )}
            <Modal
                opened={imageOverlay.isOpen}
                onClose={() => setImageOverlay({ isOpen: false, url: "" })}
                size="auto"
                padding="xs"
            >
                <Image
                    src={imageOverlay.url}
                    alt="Full size image"
                    fit="contain"
                    style={{ maxWidth: '90vw', maxHeight: '90vh' }}
                />
            </Modal>
        </Container>
    );
}
