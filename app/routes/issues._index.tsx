import { Badge, Container, Group, Select, SelectProps, Stack, Text, Title, Tooltip } from "@mantine/core";
import { LoaderFunction } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { Crag, Issue, IssueAttachment, User } from "~/lib/models";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { IconCheck, IconChevronRight, IconFlag } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { showNotification } from "@mantine/notifications";
import { getAuthenticator } from "~/lib/auth.server";

export const loader: LoaderFunction = async ({ context, request }) => {
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
    return { crags: crags, user: user };
}

export default function IssuesIndex() {
    const [searchParams] = useSearchParams();
    const { crags, user } = useLoaderData<{ crags: Crag[], user: User; }>();
    const fetcher = useFetcher();
    const [issues, setIssues] = useState<Issue[]>([]);
    const [selectedCrag, setSelectedCrag] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const cragSelectRef = useRef<HTMLInputElement>(null);
    const fz = "sm";

    useEffect(() => {
        if (fetcher.data) {
            setIssues(fetcher.data as Issue[]);
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
        if (crag?.statsActiveIssueCount !== undefined) issueCount = Number(crag?.statsActiveIssueCount);
        if (crag?.statsPublicIssueCount !== undefined) issueCount = Number(crag?.statsPublicIssueCount);
        return (
            <Group flex="1" gap="xs">
                {checked && <IconChevronRight />}
                {option.label}
                {issueCount > 0 && <Badge circle color="red">{crags.find(crag => crag.id?.toString() === option.value)?.statsActiveIssueCount}</Badge>}
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
                    scrollAreaProps={{ type: "auto" }}
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
                                    {(record.isFlagged) && (
                                        <Tooltip position="top" withArrow label={record.flaggedMessage} fz={fz}>
                                                <IconFlag fill="red" color="red" />                                  
                                        </Tooltip>)}
                                    <Text>{record.route?.name}</Text>
                                    <Badge size="xs" color="sector-color">{record.route?.sectorName}</Badge>
                                </Group>,
                        },
                        {
                            accessor: "issueType",
                        },
                        {
                            accessor: "subIssueType",
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
