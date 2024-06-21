import { Button, Code, Container, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { ActionFunction, LoaderFunction, json } from "@remix-run/cloudflare";
import { useFetcher } from "@remix-run/react";
import { Issue, User } from "kysely-codegen";
import { useEffect, useState } from "react";
import { authenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { SloperSyncResult, SyncedSector, syncSloperCragsAndSectors, syncSloperIssues, syncSloperRoutes } from "~/lib/sloper";

export interface IssueWithRoute extends Issue {
    route_name: string;
    sector_name: string;
    crag_name: string;
}

export const loader: LoaderFunction = async ({ request }) => {
    const user: User = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }
    return json({});
}

export const action: ActionFunction = async ({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }

    const formData = await request.formData();
    const action = formData.get("action");
    const sectorId = Number(formData.get("sectorId"));
    const sloperId = formData.get("sloperId")?.toString();
    if (action == "sloper-datasync") {
        return json(await syncSloperCragsAndSectors(context));
    }
    else if (action == "sloper-issuesync") {
        return json(await syncSloperIssues(context));
    }
    else if (action == "sloper-routesync" && sectorId && sloperId) {
        const syncResult = await syncSloperRoutes(context, sectorId, sloperId);
        return json({ ...syncResult, sectorId });
    }
}

export default function ManageRoutes() {
    const fetcher = useFetcher<SloperSyncResult>();
    const [logMessages, setLogMessages] = useState<string[]>([]);
    const [sectors, setSectors] = useState<SyncedSector[]>([]);
    const [syncStatus, setSyncStatus] = useState<{ [key: number]: number }>({});
    const [syncingSector, setSyncingSector] = useState<number>(0);

    useEffect(() => {
        if (fetcher.data) {
            const { log: newLogMessages, sectorList: newSectors, syncCount, sectorId } = fetcher.data;
            if (newLogMessages) {
                setLogMessages(prevMessages => [...prevMessages, ...newLogMessages]);
            }
            if (newSectors) setSectors(newSectors);
            if (syncCount && sectorId)
                {
                    setSyncStatus(prevStatus => ({ ...prevStatus, [sectorId]: syncCount }));
                }
        }
    }, [fetcher.data]);


    const handleSyncAllRoutes = async () => {
        setSyncStatus({});
        for (const sector of sectors) {
            setSyncingSector(sector.local_id);
            const formData = new FormData();
            formData.append('action', 'sloper-routesync');
            formData.append('sectorId', sector.local_id.toString());
            formData.append('sloperId', sector.external_id);
            await new Promise<void>((resolve) => {
                fetcher.submit(formData, { method: 'post', action: '/routes/manage' });
                const interval = setInterval(() => {
                    if (fetcher.state === 'idle') {
                        clearInterval(interval);
                        resolve();
                    }
                }, 3000);
            });
        }
        setSyncingSector(0);
    };

    return (
        <Container size="xl" p="md">
            <Stack>
                <Title order={1}>Manage Routes</Title>
                <fetcher.Form method="post">
                    <Group>
                        <Button name="action" value="sloper-datasync" type="submit">Sync Crag Data</Button>
                        <Button name="action" value="sloper-issuesync" type="submit">Sync Issues</Button>
                        <Button onClick={handleSyncAllRoutes} disabled={(!sectors.length || syncingSector > 0)}>Sync All Routes</Button>
                    </Group>
                </fetcher.Form>
                {sectors.length > 0 && (
                    <Table>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Sector Id</Table.Th>
                                <Table.Th>Sector Name</Table.Th>
                                <Table.Th>Sloper Id</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {sectors.map((sector) => (
                                <tr key={sector.local_id}>
                                    <td>{sector.local_id}</td>
                                    <td>{sector.name}</td>
                                    <td>{sector.external_id}</td>
                                    <td>
                                        {syncStatus[sector.local_id] !== undefined ? (
                                            <span>✔️ {syncStatus[sector.local_id]}</span>
                                        ) : (
                                            syncingSector && <Loader size="sm" />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}
                {logMessages.length > 0 && (
                    <Code>
                        {logMessages.map((message, index) => (
                            <Text key={index}>{message}</Text>
                        ))}
                    </Code>
                )}
            </Stack>
        </Container>
    );
}
