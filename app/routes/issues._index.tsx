import { Badge, Center, Container, Group, Select, Stack, Text, Title } from "@mantine/core";
import { LoaderFunction, json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { Crag, Issue } from "kysely-codegen";
import { DataTable } from "mantine-datatable";
import { getDB } from "~/lib/db";
import { IconClick } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 15;

export interface IssueWithRoute extends Issue {
    route_name: string;
    sector_name: string;
    crag_name: string;
}

export const loader: LoaderFunction = async ({ context }) => {
    const db = getDB(context);
    const result = await db.selectFrom('crag')
        .select([
            'crag.id',
            'crag.name',
        ])
        .execute();
    return json(result);
}


export default function IssuesIndex() {
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

    return (
        <Container size="xl" p="md">

            <Stack>
                <Title order={1}>Route Issues</Title>
                <Link to={`/issues/create`}>Submit new issue</Link>
                <Select
                    label="Pick a crag"
                    placeholder="Pick one"
                    searchable
                    maxDropdownHeight={600}
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
                    noRecordsText={ selectedCrag.id ? `No issues found at ${selectedCrag.name}.` : "Select a crag to search for issues." }
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
                        },
                    ]}

                />
            </Stack>
        </Container>
    );
}
