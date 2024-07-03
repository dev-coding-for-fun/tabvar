import { Badge, Container, Group, Select, SelectProps, Stack, Text, Title, Tooltip } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { Crag, Issue, IssueAttachment, User } from "kysely-codegen";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { IconCheck, IconChevronRight, IconFlag } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { showNotification } from "@mantine/notifications";
import { getAuthenticator } from "~/lib/auth.server";

export interface IssueWithRoute extends Omit<Issue, 'id'> {
    id: number;
    route_name: string;
    sector_name: string;
    crag_name: string;
    attachments?: Partial<IssueAttachment>[];
}

export const loader: LoaderFunction = async ({ context, request }) => {
    const x = await getAuthenticator(context);
        const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });

    const db = getDB(context);
    const crags = await db.selectFrom('crag')
        .select([
            'crag.id',
            'crag.name',
            (user.role) ? 'crag.stats_active_issue_count' : 'crag.stats_public_issue_count',
            'crag.stats_issue_flagged',
        ]).orderBy([(user.role) ? 'crag.stats_active_issue_count desc' : 'crag.stats_public_issue_count desc', 'crag.name'])
        .execute();
    return json({ crags: crags, user: user });
}


export default function IssuesIndex() {
    const [searchParams] = useSearchParams();
    const { crags, user } = useLoaderData<{ crags: Crag[], user: User; }>();
    const fetcher = useFetcher();
    const [issues, setIssues] = useState<IssueWithRoute[]>([]);
    const [selectedCrag, setSelectedCrag] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const cragSelectRef = useRef<HTMLInputElement>(null);
    const fz = "sm";

    useEffect(() => {
        if (fetcher.data) {
            setIssues(fetcher.data as IssueWithRoute[]);
        }
    }, [fetcher.data]);

    useEffect(() => {
        if (searchParams.get('success') === 'true') {
            showNotification({
                title: 'Success',
                message: 'Issue submitted successfully',
                color: 'green',
                icon: <IconCheck />,
                autoClose: 3000,
            });
            searchParams.delete('success');
            window.history.replaceState({}, '', `${window.location.pathname}?${searchParams.toString()}`);
        }
    }, [searchParams]);

    const renderSelectOption: SelectProps['renderOption'] = ({ option, checked }) => {
        const crag = crags.find(crag => crag.id?.toString() === option.value);
        let issueCount: number = 0;
        if (crag?.stats_active_issue_count !== undefined) issueCount = Number(crag?.stats_active_issue_count);
        if (crag?.stats_public_issue_count !== undefined) issueCount = Number(crag?.stats_public_issue_count);
        return (
            <Group flex="1" gap="xs">
                {checked && <IconChevronRight />}
                {option.label}
                {issueCount > 0 && <Badge circle color="red">{crags.find(crag => crag.id?.toString() === option.value)?.stats_active_issue_count}</Badge>}
            </Group>
        )
    };

    return (
        <Container size="xl" p="md">

            <Stack>
                <Title order={1}>Route Issues</Title>
                <Stack gap="xs">
                    <Link to={`/issues/create`}>➕ Submit New Issue</Link>
                    {(user.role === 'admin' || user.role === "member") && (
                        <Link to={`/issues/manage`}>⚙️ Manage Issues</Link>
                    )}
                </Stack>
                <Select
                    label="Pick a crag"
                    placeholder="Pick one"
                    searchable
                    maxDropdownHeight={600}
                    renderOption={renderSelectOption}
                    data={crags.map((crag) => ({ value: crag.id.toString(), label: crag.name ?? '' }))}
                    onChange={(value) => {
                        const selectedCrag = crags.find(crag => crag.id?.toString() === value);
                        if (selectedCrag) {
                            setSelectedCrag({ id: selectedCrag.id.toString(), name: selectedCrag.name });
                            fetcher.load(`/api/issues?cragid=${value}`);
                            cragSelectRef.current?.blur();
                        }
                    }}
                    ref={cragSelectRef}
                />
                <DataTable
                    withTableBorder
                    borderRadius="sm"
                    withColumnBorders
                    striped
                    highlightOnHover
                    minHeight={150}
                    noRecordsText={selectedCrag.id ? `No issues found at ${selectedCrag.name}.` : "Select a crag to search for issues."}
                    records={issues}
                    columns={[
                        {
                            accessor: "route_name",
                            render: (record) =>
                                <Group>
                                    {(record.is_flagged === 1) && (
                                        <Tooltip position="top" withArrow label={record.flagged_message} fz={fz}>
                                                <IconFlag fill="red" color="red" />                                  
                                        </Tooltip>)}
                                    <Text>{record.route_name}</Text>
                                    <Badge size="xs" color="sector-color">{record.sector_name}</Badge>
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
                                <Badge size="md" color={`status-${record.status.toLowerCase().trim()}`}>{record.status}</Badge>,
                        },
                    ]}

                />
            </Stack>
        </Container>
    );
}
