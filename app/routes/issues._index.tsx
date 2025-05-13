import { Badge, Container, Group, Select, SelectProps, Stack, Text, Title, Tooltip, Anchor } from "@mantine/core";
import { LoaderFunction } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { Crag, IssueWithDetails, User } from "~/lib/models";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { IconCheck, IconChevronRight, IconFlag } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { showNotification } from "@mantine/notifications";
import { requireUser } from "~/lib/auth.server";
import { sql } from "kysely";

export const loader: LoaderFunction = async ({ context, request }) => {
    const user = await requireUser(request, context);

    const db = getDB(context);
    const crags = await db.selectFrom('crag')
        .select([
            'crag.id',
            'crag.name',
            'crag.stats_public_issue_count as statsPublicIssueCount',
            (user.role && user.role !== 'anonymous') ? 'crag.stats_active_issue_count as statsActiveIssueCount' : sql.lit(null).as('statsActiveIssueCount'),
        ]).orderBy([(user.role) ? 'crag.stats_active_issue_count desc' : 'crag.stats_public_issue_count desc', 'crag.name'])
        .execute();
    return { crags: crags, user: user };
}

export default function IssuesIndex() {
    const [searchParams] = useSearchParams();
    const { crags, user } = useLoaderData<{ crags: Crag[], user: User; }>();
    const fetcher = useFetcher();
    const [issues, setIssues] = useState<IssueWithDetails[]>([]);
    const [selectedCrag, setSelectedCrag] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const cragSelectRef = useRef<HTMLInputElement>(null);
    const fz = "sm";

    useEffect(() => {
        if (fetcher.data) {
            setIssues(fetcher.data as IssueWithDetails[]);
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
        const issueCount = crag?.statsPublicIssueCount ?? 0;
        const unmoderatedIssueCount = (crag?.statsActiveIssueCount) ? crag.statsActiveIssueCount - issueCount : 0;
        return (
            <Group flex="1" gap="xs">
                {checked && <IconChevronRight />}
                {option.label}
                {issueCount > 0 && <Badge circle color="red">{issueCount}</Badge>}
                {unmoderatedIssueCount > 0 && <Badge circle color="blue">{unmoderatedIssueCount}</Badge>}
            </Group>
        )
    };

    return (
        <Container size="xl" p="md">

            <Stack>
                <Group gap="xs" mb="md" align="center">
                    <Title order={1}>Route Issues</Title>
                    <Anchor component={Link} to="/topos" ml="md">
                        🗺️ Climbing Areas
                    </Anchor>
                </Group>
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
                    records={issues as IssueWithDetails[]}
                    columns={[
                        {
                            accessor: "routeName", 
                            render: (record) =>
                                <Group>
                                    {(record.isFlagged) && (
                                        <Tooltip position="top" withArrow label={record.flaggedMessage} fz={fz}>
                                                <IconFlag fill="red" color="red" />                                  
                                        </Tooltip>)}
                                    <Text>{record.routeName}</Text>
                                    <Badge size="xs" color="sector-color">{record.sectorName}</Badge>
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
                            render: (record) =>
                                record.description?.split("\n").map((line: string, index: number) => <p key={index}>{line}</p>) || null,
                        },
                        {
                            accessor: "status",
                            render: (record) =>
                                <Badge size="xs" color={`status-${record.status.toLowerCase().trim()}`}>{record.status}</Badge>,
                            width: '114px',
                        },
                    ]}

                />
            </Stack>
        </Container>
    );
}
