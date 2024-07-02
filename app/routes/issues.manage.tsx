import { Badge, Box, Button, Center, Container, Group, Text, Image, rem, Modal, Stack, Title, Tooltip } from "@mantine/core";
import { ActionFunction, AppLoadContext, LoaderFunction, json } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { authenticator } from "~/lib/auth.server";
import { IconArchive, IconArrowBack, IconCheck, IconClick, IconEdit, IconFileX, IconFlag, IconRubberStamp } from "@tabler/icons-react";
import IssueDetailsModal from "~/components/issueDetailModal";
import { useDisclosure } from "@mantine/hooks";
import { IssueWithRoute } from "./issues._index";
import { useEffect, useRef, useState } from "react";
import { PERMISSION_ERROR } from "~/lib/constants";
import { deleteFromR2 } from "~/lib/s3.server";
import { R2_UPLOADS_BUCKET } from "./issues.create";
import { Issue, User } from "kysely-codegen";


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
                <Group gap={4} justify="right" wrap="nowrap">
                    <Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("restore")}>Restore</Button>
                    <Button size="compact-xs" color={'red'} leftSection={<IconFileX style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("delete")}>Destroy</Button>
                </Group>
            );
        default:
            return (<Button size="compact-xs" leftSection={<IconArrowBack style={{ width: rem(14), height: rem(14) }} />} onClick={() => handleStatusChange("restore")}>Fix Status</Button>);
    }
};

async function modifyIssue(context: AppLoadContext, issueId: number, updates: Partial<Issue>, user: User) {
    const db = getDB(context);
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();
    await db.updateTable('issue')
        .set({
            issue_type: updates.issue_type,
            sub_issue_type: updates.sub_issue_type,
            description: updates.description,
            is_flagged: updates.is_flagged,
            flagged_message: updates.flagged_message,
            last_modified: new Date().toISOString(),
        })
        .where('id', '=', issueId)
        .execute();
    await db.insertInto('issue_audit_log')
        .values({
            issue_id: issueId,
            action: "update",
            uid: user.uid,
            user_display_name: user.display_name,
            user_role: user.role,
            before_issue_type: issue.issue_type,
            after_issue_type: updates.issue_type,
            before_sub_issue_type: issue.sub_issue_type,
            after_sub_issue_type: updates.sub_issue_type,
            before_description: issue.description,
            after_description: updates.description,
            before_is_flagged: issue.is_flagged,
            after_is_flagged: updates.is_flagged,
            before_flagged_message: issue.flagged_message,
            after_flagged_message: updates.flagged_message,

        })
        .execute();
}

async function modifyIssueStatus(context: AppLoadContext, issueId: number, updates: Partial<Omit<Issue, "id" | "created_at">>, user: User) {
    const db = getDB(context);
    updates.last_modified = new Date().toISOString();
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();
    await db.updateTable('issue')
        .set(updates)
        .where('id', '=', issueId)
        .execute();

    await db.insertInto('issue_audit_log')
        .values({
            issue_id: issueId,
            action: "update",
            uid: user.uid,
            user_display_name: user.display_name,
            user_role: user.role,
            before_status: issue.status,
            after_status: updates.status,
        }).execute();
}

async function deleteIssue(context: AppLoadContext, issueId: number, user: User) {
    const db = getDB(context);
    const issue = await db.selectFrom('issue').selectAll()
        .where('id', '=', issueId).executeTakeFirstOrThrow();
    const attachments = await db.selectFrom('issue_attachment')
        .select(['url'])
        .where('issue_id', '=', issueId).execute();
    if (attachments.length > 0) {
        for (const attachment of attachments) {
            await deleteFromR2(context, R2_UPLOADS_BUCKET, attachment.url);
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
            user_display_name: user.display_name,
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
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin' && user.role !== 'member') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }
    const formData = await request.formData();
    const action = formData.get("action");
    const status = formData.get("status")?.toString() ?? "";
    const issueId = Number(formData.get("issueId"));
    if (issueId) {
        switch (action) {
            case "updateIssue": {
                const issueUpdates: Partial<Issue> = {
                    issue_type: formData.get("issueType")?.toString(),
                    sub_issue_type: formData.get("subIssueType")?.toString(),
                    description: formData.get("description")?.toString(),
                    is_flagged: formData.get("isFlagged") === "on" ? 1 : 0,
                    flagged_message: formData.get("safetyNotice")?.toString(),
                };

                try {
                    modifyIssue(context, issueId, issueUpdates, user);
                    return json({ success: true, message: 'Issue updated' });
                } catch (error) {
                    console.error('Error updating issue:', error);
                    return json({ success: false, message: 'Failed to update issue' }, { status: 500 });
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
                            last_status: status,
                            approved_at: new Date().toISOString(),
                            approved_by_uid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }

                break;
            case "archive":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Archived",
                            last_status: status,
                            archived_at: new Date().toISOString(),
                            archived_by_uid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "complete":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Completed",
                            last_status: status,
                            archived_at: new Date().toISOString(),
                            archived_by_uid: user.uid,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            case "revert":
                try {
                    modifyIssueStatus(
                        context,
                        issueId,
                        {
                            status: "Reported",
                            last_status: status,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
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
                            last_status: status,
                        },
                        user);
                } catch (error) {
                    console.error('Error updating issue status:', error);
                    return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                }
                break;
            }
            case "delete": {
                if (user.role == 'admin') {
                    try {
                        deleteIssue(context, issueId, user);
                    } catch (error) {
                        console.error('Error updating issue status:', error);
                        return json({ success: false, message: 'Failed to update issue status' }, { status: 500 });
                    }
                }
                else return json({ success: false, message: 'Admin role required to permanently delete issues' }, { status: 403 });
                break;

            }
            default:
                return json({ success: false, message: 'Invalid action' }, { status: 400 });
        }
    }
    return json({ success: true });
}

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin' && user.role !== 'member') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }
    const db = getDB(context);
    const result = await db.selectFrom('issue')
        .innerJoin('route', 'route.id', 'issue.route_id')
        .leftJoin('issue_attachment', 'issue_attachment.issue_id', 'issue.id')
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
            'is_flagged',
            'flagged_message',
            'bolts_affected',
            'issue_attachment.id as attachment_id',
            'issue_attachment.url',
            'issue_attachment.name as attachment_name',
        ])
        .execute();
    const issues = result.reduce<Record<number, Partial<IssueWithRoute>>>((acc, row) => {
        if (!acc[row.id]) {
            acc[row.id] = {
                id: Number(row.id),
                route_name: row.route_name,
                sector_name: row.sector_name ?? "",
                crag_name: row.crag_name ?? "",
                issue_type: row.issue_type,
                sub_issue_type: row.sub_issue_type,
                status: row.status,
                last_status: row.last_status,
                description: row.description,
                is_flagged: row.is_flagged,
                flagged_message: row.flagged_message,
                bolts_affected: row.bolts_affected,
                attachments: [],
            };

        }
        if (row.url && row.attachment_name) {
            acc[row.id].attachments?.push({ url: context.cloudflare.env.R2_BUCKET_DOMAIN + row.url, name: row.attachment_name });
        }
        return acc;
    }, {});

    return json({
        issues: Object.values(issues),
        user: user
    });
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
    const { issues, user } = useLoaderData<{ issues: IssueWithRoute[]; user: User; }>();
    const [opened, { open, close }] = useDisclosure(false);
    const [openIssue, setOpenIssue] = useState<IssueWithRoute>();
    const [imageOverlay, setImageOverlay] = useState<{ isOpen: boolean; url: string }>({
        isOpen: false,
        url: "",
    });
    const fz = "sm";

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
        <Container size="xl">
            <Stack>
                <Title id="title" order={1}>Route Issues</Title>
                <Stack gap="xs">
                    <Link to={`/issues/create`}>➕ Submit New Issue</Link>
                    {(user.role === 'admin' || user.role === "member") && (
                        <Link to={`/issues/`}>🔍 Explore Issues</Link>
                    )}
                </Stack>
                <DataTable
                    withTableBorder
                    borderRadius="sm"
                    fz={fz}
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
                                <Group gap={4}>
                                    {(record.is_flagged === 1) && (
                                        <Tooltip position="top" withArrow label={record.flagged_message} fz={fz}>
                                                <IconFlag fill="red" color="red" />                                  
                                        </Tooltip>)}
                                    <Text fz={fz}>{record.route_name}</Text>
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
                <a href="#title">🔝 Back to top</a>
            </Stack>
            {openIssue && (
                <IssueDetailsModal
                    opened={opened} onClose={close} issue={openIssue}
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
