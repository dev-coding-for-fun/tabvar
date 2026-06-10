import { Badge, type BadgeProps, Box, Button, Center, Collapse, Container, Group, Text, Image, rem, Modal, Stack, Timeline, Title, Tooltip, TextInput, ActionIcon, Anchor, SegmentedControl } from "@mantine/core";
import { TruncatedTooltip } from "~/components/TruncatedTooltip";
import { useIsTruncated } from "~/components/useIsTruncated";
import { notifications } from "@mantine/notifications";
import { ActionFunction, LoaderFunction, data, type MetaFunction } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { DataTable, type DataTableColumn, type DataTableSortStatus } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { requireUser } from "~/lib/auth.server";
import { IconArchive, IconArrowBack, IconCheck, IconChevronDown, IconChevronUp, IconClick, IconEdit, IconFileX, IconFlag, IconRubberStamp, IconTrafficCone } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { PERMISSION_ERROR } from "~/lib/constants";
import { Issue, Route, User, RouteSearchResults, type IssueAttachment, type StatusHistoryEntry } from "~/lib/models";
import { deleteIssue, modifyIssue, modifyIssueStatus } from "~/lib/issues.server";
import { privatePageMeta } from "~/lib/seo";

const StatusActions: React.FC<{
    status: string,
    lastStatus: string | null,
    issueId: number,
}> = ({ status, lastStatus, issueId }) => {
    const fetcher = useFetcher();

    // Monitor fetcher state and show notifications
    useEffect(() => {
        if (fetcher.state === 'idle' && fetcher.data) {
            const response = fetcher.data as { success: boolean; message?: string; error?: string };
            
            if (response.success) {
                notifications.show({
                    title: 'Success',
                    message: response.message || 'Issue status updated successfully',
                    color: 'green',
                });
            } else {
                const errorMessage = response.message || response.error || 'Failed to update issue status';
                console.error('Issue status update failed:', errorMessage);
                notifications.show({
                    title: 'Error',
                    message: errorMessage,
                    color: 'red',
                });
            }
        } else if (fetcher.state === 'idle' && fetcher.data === undefined) {
            // Initial state, no action needed
        }
    }, [fetcher.state, fetcher.data]);

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
                    <Tooltip label="Claim">
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={() => handleStatusChange("claim")}
                        >
                            <IconTrafficCone size={20} />
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

export const action: ActionFunction = async ({ request, context }) => {
    const user = await requireUser(request, context);
    if (user.role !== 'admin' && user.role !== 'super' && user.role !== 'member') {
        return data({ error: PERMISSION_ERROR }, { status: 403 });
    }
    const formData = await request.formData();
    const action = formData.get("action");
    const status = formData.get("status")?.toString() ?? "";
    const issueId = Number(formData.get("issueId"));
    if (issueId) {
        switch (action) {
            case "updateIssue": {
                console.log('Issue update action triggered for issueId:', issueId);
                const issueUpdates: Partial<Issue> = {
                    issueType: formData.get("issueType")?.toString(),
                    subIssueType: formData.get("subIssueType")?.toString(),
                    description: formData.get("description")?.toString(),
                    isFlagged: formData.get("isFlagged") === "on" ? true : false,
                    flaggedMessage: formData.get("safetyNotice")?.toString(),
                    boltsAffected: formData.get("boltNumbers")?.toString(),
                };

                try {
                    await modifyIssue(context, issueId, issueUpdates, user);
                    return data({ success: true, message: 'Issue updated' });
                } catch (error) {
                    console.error('Error updating issue:', error);
                    return data({ success: false, message: 'Failed to update issue' }, { status: 500 });
                }
                break;
            }
            case "accept":
                console.log('Issue accept action triggered for issueId:', issueId);
                try {
                    await modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Reported",
                            lastStatus: status,
                            approvedAt: new Date().toISOString(),
                            approvedByUid: user.uid,
                        },
                        user);
                    return data({ success: true, message: 'Issue accepted' });
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
            case "archive":
                console.log('Issue archive action triggered for issueId:', issueId);
                try {
                    await modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Archived",
                            lastStatus: status,
                            archivedAt: new Date().toISOString(),
                            archivedByUid: user.uid,
                        },
                        user);
                    return data({ success: true, message: 'Issue archived' });
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "complete":
                console.log('Issue complete action triggered for issueId:', issueId);
                try {
                    await modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Completed",
                            lastStatus: status,
                            archivedAt: new Date().toISOString(),
                            archivedByUid: user.uid,
                        },
                        user);
                    return data({ success: true, message: 'Issue marked as complete' });
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "revert":
                console.log('Issue revert action triggered for issueId:', issueId);
                try {
                    await modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Reported",
                            lastStatus: status,
                        },
                        user);
                    return data({ success: true, message: 'Issue reverted' });
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "restore": {
                console.log('Issue restore action triggered for issueId:', issueId);
                try {
                    const newStatus = formData.get("lastStatus") ? formData.get("lastStatus")?.toString() : "Reported";
                    await modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: newStatus,
                            lastStatus: status,
                        },
                        user);
                    return data({ success: true, message: 'Issue restored' });
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return data({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            }
            case "delete": {
                console.log('Issue delete action triggered for issueId:', issueId);
                if (user.role == 'admin') {
                    try {
                        await deleteIssue(context, issueId, user);
                        return data({ success: true, message: 'Issue permanently deleted' });
                    } catch (error) {
                        console.error('Error deleting issue:', error);
                        return data({ success: false, message: 'Failed to delete issue' }, { status: 500 });
                    }
                }
                else return data({ success: false, message: 'Admin role required to permanently delete issues' }, { status: 403 });
                break;

            }
            case "claim":
                // TODO: implement claiming. Replace this line with the real claim logic.
                return data({ success: false, message: 'Claiming issues is not implemented yet.' }, { status: 400 });
            default:
                return data({ success: false, message: 'Invalid action' }, { status: 400 });
        }
    }
    return { success: true };
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await requireUser(request, context);
    if (user.role !== 'admin' && user.role !== 'super' && user.role !== 'member') {
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

    // Group results by issue ID to handle multiple attachments properly
    const issuesMap = new Map<number, Issue>();
    
    result.forEach((row) => {
        const issueId = Number(row.id);
        
        if (!issuesMap.has(issueId)) {
            const route: Route = {
                id: row.route_id,
                name: row.route_name,
                sectorName: row.sector_name ?? "",
                cragName: row.crag_name ?? "",
            } as Route;
            
            issuesMap.set(issueId, {
                id: issueId,
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
                attachments: []
            } as Issue);
        }
        
        // Add attachment if it exists
        if (row.url && row.attachment_name && row.attachment_id) {
            const issue = issuesMap.get(issueId)!;
            if (!issue.attachments) {
                issue.attachments = [];
            }
            issue.attachments.push({
                id: row.attachment_id,
                issueId: row.id,
                url: row.url,
                type: "image",
                name: row.attachment_name
            });
        }
    });
    
    // Build per-issue status history from the audit log (rows that changed status).
    // Join against `issue` rather than passing an `issue_id IN (...)` list so the
    // query carries no bound parameters — D1 rejects queries with more than 100,
    // which an unbounded id list would exceed on large datasets.
    if (issuesMap.size > 0) {
        const auditLogs = await db.selectFrom('issue_audit_log')
            .innerJoin('issue', 'issue.id', 'issue_audit_log.issue_id')
            .select([
                'issue_audit_log.issue_id as issue_id',
                'issue_audit_log.before_status as before_status',
                'issue_audit_log.after_status as after_status',
                'issue_audit_log.timestamp as timestamp',
                'issue_audit_log.user_display_name as user_display_name',
            ])
            .where('issue_audit_log.after_status', 'is not', null)
            .orderBy('issue_audit_log.timestamp', 'asc')
            .orderBy('issue_audit_log.id', 'asc')
            .execute();

        const logsByIssue = new Map<number, typeof auditLogs>();
        auditLogs.forEach((log) => {
            const arr = logsByIssue.get(log.issue_id) ?? [];
            arr.push(log);
            logsByIssue.set(log.issue_id, arr);
        });

        issuesMap.forEach((issue, id) => {
            const logs = logsByIssue.get(id) ?? [];
            const history: StatusHistoryEntry[] = [];

            if (logs.length > 0) {
                // The first transition's "before" value is the status the issue was created with
                history.push({
                    status: logs[0].before_status ?? issue.status,
                    timestamp: issue.createdAt,
                    userDisplayName: null,
                });
                logs.forEach((log) => {
                    history.push({
                        status: log.after_status as string,
                        timestamp: log.timestamp,
                        userDisplayName: log.user_display_name,
                    });
                });
            } else {
                history.push({
                    status: issue.status,
                    timestamp: issue.createdAt,
                    userDisplayName: null,
                });
            }

            issue.statusHistory = history;
            issue.lastUpdated = history[history.length - 1]?.timestamp ?? issue.createdAt;
        });
    }

    const issues: Issue[] = Array.from(issuesMap.values());

    return {
        issues,
        user
    };
}

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("Manage issues");

const TruncatableDescription: React.FC<{ description: string, fz: string }> = ({ description, fz }) => {
    const [expanded, setExpanded] = useState(false);
    const { ref, isTruncated } = useIsTruncated<HTMLDivElement>();

    const toggleExpanded = () => setExpanded(!expanded);

    return (
        <Box>
            <Text
                fz={fz}
                ref={ref}
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

// SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC without a timezone marker,
// while other timestamps are stored as ISO strings. Normalize both before formatting.
function formatDateTime(value?: string | null): string {
    if (!value) return "—";
    const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

// Mantine clips the inner label, not the badge root
const BADGE_LABEL_SELECTOR = ".mantine-Badge-label";

const TruncatableBadge: React.FC<BadgeProps & { children: React.ReactNode }> = ({ children, ...props }) => (
    <TruncatedTooltip label={children} truncationSelector={BADGE_LABEL_SELECTOR} withArrow fz="xs">
        <Badge {...props}>{children}</Badge>
    </TruncatedTooltip>
);

const statusBadge = (status: string) => (
    <TruncatableBadge size="xs" color={`status-${status.toLowerCase().replace(" ", "-")}`}>{status}</TruncatableBadge>
);

const statusMeta = (entry?: StatusHistoryEntry) => {
    if (!entry) return null;
    const when = formatDateTime(entry.timestamp);
    return entry.userDisplayName ? `${when} by ${entry.userDisplayName}` : when;
};

const StatusCell: React.FC<{ issue: Issue }> = ({ issue }) => {
    const [expanded, setExpanded] = useState(false);
    const history = issue.statusHistory ?? [];
    const current = history[history.length - 1];
    // Older states, most recent first; the current state is shown above
    const priorStates = history.slice(0, -1).reverse();
    const hasHistory = priorStates.length > 0;

    return (
        <Stack gap={4}>
            <Group gap={4} wrap="nowrap">
                {statusBadge(issue.status)}
                {hasHistory && (
                    <Tooltip label={expanded ? "Hide history" : "Show history"}>
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            onClick={() => setExpanded((value) => !value)}
                            aria-label={expanded ? "Hide status history" : "Show status history"}
                        >
                            {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                        </ActionIcon>
                    </Tooltip>
                )}
            </Group>
            <Text fz="xs" c="dimmed">{statusMeta(current)}</Text>
            {hasHistory && (
                <Collapse expanded={expanded}>
                    <Timeline bulletSize={12} lineWidth={2} active={priorStates.length} mt={4}>
                        {priorStates.map((entry: StatusHistoryEntry, index) => (
                            <Timeline.Item key={index} title={statusBadge(entry.status)}>
                                <Text fz="xs" c="dimmed">{statusMeta(entry)}</Text>
                            </Timeline.Item>
                        ))}
                    </Timeline>
                </Collapse>
            )}
        </Stack>
    );
};

const statusFilterOptions = ['All', 'Public', 'In Moderation', 'Complete', 'Archived'];

export default function IssuesManager() {
    const { issues, user } = useLoaderData<{ issues: Issue[]; user: User; }>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<Issue>();
    const [selectedResult, setSelectedResult] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [displayIssues, setDisplayIssues] = useState<Issue[]>(issues);
    const [baseFilteredIssues, setBaseFilteredIssues] = useState<Issue[]>(issues);
    const searchFetcher = useFetcher<RouteSearchResults[]>();
    const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Issue>>({ columnAccessor: 'id', direction: 'asc' });
    const [statusFilter, setStatusFilter] = useState<string>(statusFilterOptions[0]);
    const [imageOverlay, setImageOverlay] = useState<{ isOpen: boolean; url: string }>({
        isOpen: false,
        url: "",
    });
    const fz = "sm";

    useEffect(() => {
        let filtered = [...issues];

        if (searchFetcher.data && searchQuery.length > 1) {
            const searchResults = searchFetcher.data;
            filtered = filtered.filter(issue =>
                searchResults.some(route => issue.routeId === route.routeId)
            );
        } else if (searchQuery.length > 1 && !searchFetcher.data && searchFetcher.state === 'idle') {
            filtered = [];
        }

        const lowerCaseStatusFilter = statusFilter.toLowerCase();
        if (lowerCaseStatusFilter !== 'all') {
            filtered = filtered.filter(issue => {
                const lowerCaseStatus = issue.status.toLowerCase();
                switch (lowerCaseStatusFilter) {
                    case 'public':
                        return lowerCaseStatus === 'reported' || lowerCaseStatus === 'viewed';
                    case 'in moderation':
                        return lowerCaseStatus === 'in moderation';
                    case 'complete':
                        return lowerCaseStatus === 'completed';
                    case 'archived':
                        return lowerCaseStatus === 'archived';
                    default:
                        return true;
                }
            });
        } else {
            filtered = filtered.filter(issue => issue.status.toLowerCase() !== 'archived');
        }

        setBaseFilteredIssues(filtered);

    }, [issues, searchQuery, searchFetcher.data, searchFetcher.state, statusFilter]);

    useEffect(() => {
        const data = [...baseFilteredIssues];
        const { columnAccessor, direction } = sortStatus;

        data.sort((a, b) => {
            let valueA: any;
            let valueB: any;

            if (columnAccessor === 'route.name') {
                valueA = a.route?.name?.toLowerCase() ?? '';
                valueB = b.route?.name?.toLowerCase() ?? '';
            } else {
                const accessor = columnAccessor as Exclude<keyof Issue, 'route'>; 
                valueA = a[accessor];
                valueB = b[accessor];
            }

            const comparison = 
                typeof valueA === 'number' && typeof valueB === 'number' ? valueA - valueB :
                String(valueA ?? '').localeCompare(String(valueB ?? ''));

            return direction === 'asc' ? comparison : -comparison;
        });
        setDisplayIssues(data);
    }, [baseFilteredIssues, sortStatus]);

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
                    <Link to={`/issues/`}>🔍 Explore Issues</Link>
                </Stack>

                <TextInput
                    mt="md"
                    placeholder="Filter by route, sector, or crag..."
                    value={searchQuery}
                    onChange={(event) => {
                        const query = event.currentTarget.value;
                        setSearchQuery(query);
                        if (query.length > 1) {
                            searchFetcher.load(`/api/search?query=${encodeURIComponent(query)}&limit=500`);
                        } else {
                            setBaseFilteredIssues(issues.filter(issue => {
                                const lowerCaseStatusFilter = statusFilter.toLowerCase();
                                if (lowerCaseStatusFilter !== 'all') {
                                    const lowerCaseStatus = issue.status.toLowerCase();
                                    switch (lowerCaseStatusFilter) {
                                        case 'public': return lowerCaseStatus === 'reported' || lowerCaseStatus === 'viewed';
                                        case 'in moderation': return lowerCaseStatus === 'in moderation';
                                        case 'complete': return lowerCaseStatus === 'completed';
                                        case 'archived': return lowerCaseStatus === 'archived';
                                        default: return true;
                                    }
                                } else {
                                    return issue.status.toLowerCase() !== 'archived';
                                }
                            }));
                        }
                    }}
                />

                <SegmentedControl
                    mt="xs"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    data={statusFilterOptions}
                />

                <DataTable<Issue>
                    sortStatus={sortStatus}
                    onSortStatusChange={setSortStatus}
                    withTableBorder
                    borderRadius="sm"
                    fz={fz}
                    withColumnBorders
                    striped
                    highlightOnHover
                    records={displayIssues}
                    columns={[
                        {
                            accessor: "id",
                            sortable: true,
                            textAlign: "right",
                        },
                        {
                            accessor: "route.name",
                            sortable: true,
                            render: (record: Issue) =>
                                <Group gap={4}>
                                    {record.isFlagged && (
                                        <Tooltip position="top" withArrow label={record.flaggedMessage} fz={fz}>
                                            <IconFlag fill="red" color="red" />
                                        </Tooltip>)}
                                    <Text fz={fz}>{record.route?.name}</Text>
                                    <Group gap={4} wrap="nowrap">
                                        <TruncatableBadge size="xs" color="sector-color">{record.route?.sectorName}</TruncatableBadge>
                                        <TruncatableBadge size="xs" color="crag-color">{record.route?.cragName}</TruncatableBadge>
                                    </Group>
                                </Group>
                        },
                        {
                            accessor: "issueType",
                            sortable: true,
                        },
                        {
                            accessor: "subIssueType",
                            title: "Sub Type"
                        },
                        {
                            accessor: "description",
                            render: (record: Issue) => <TruncatableDescription fz={fz} description={record.description || ''} />,
                        },
                        {
                            accessor: "Images",
                            render: (record: Issue) => (
                                <Group gap={2}>
                                    {record.attachments?.map((attachment: IssueAttachment) => (
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
                            render: (record) => <StatusCell issue={record} />,
                            width: '180px',
                            sortable: true,
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
