import { Badge, Center, Container, Group, Select, SelectProps, Stack, Text, Title } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { Crag, Issue } from "kysely-codegen";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { IconCheck, IconClick, IconViewfinder } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { showNotification } from "@mantine/notifications";
import { authenticator } from "~/lib/auth.server";

export interface IssueWithRoute extends Issue {
    route_name: string;
    sector_name: string;
    crag_name: string;
}

export const loader: LoaderFunction = async ({ context, request }) => {
    const user: User = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });

    const db = getDB(context);
    const result = await db.selectFrom('crag')
        .select([
            'crag.id',
            'crag.name',
            (user.role) ? 'crag.stats_active_issue_count' : 'crag.stats_public_issue_count',
            'crag.stats_issue_flagged',
        ])
        .execute();
    return json(result);
}


export default function IssuesIndex() {
    const [searchParams] = useSearchParams();
    const crags = useLoaderData<Crag[]>();
    const fetcher = useFetcher();
    const [issues, setIssues] = useState<IssueWithRoute[]>([]);
    const [selectedCrag, setSelectedCrag] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const cragSelectRef = useRef<HTMLInputElement>(null);

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
                {checked && <IconViewfinder />}
                {option.label}
                {issueCount > 0 && <Badge circle color="red">{crags.find(crag => crag.id?.toString() === option.value)?.stats_active_issue_count}</Badge>}
            </Group>
        )
    };

    return (
        <Container size="xl" p="md">

            <Stack>
                <Title order={1}>Route Issues</Title>
                <Link to={`/issues/create`}>➕ Submit new issue</Link>
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
                            accessor: "id",
                            textAlign: "right",
                        },
                        {
                            accessor: "route_name",
                            render: (record) =>
                                <Group>
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
                        {
                            accessor: "actions",
                            title: (<Center><IconClick size={16} /></Center>),
                            width: '0%',
                        },
                    ]}

                />
            </Stack>
        </Container>
    );
}
