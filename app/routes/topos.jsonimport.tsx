import { useFetcher } from "@remix-run/react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import {
    Paper,
    Title,
    Container,
    Stack,
    Alert,
    Text,
    Table,
    Badge,
    Group
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconUpload, IconX, IconFile, IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { getAuthenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { RequirePermission } from "~/components/RequirePermission";

type RouteData = {
    Crag: string;
    Sector: string;
    Route: string;
    Difficulty: string;
    FirstAscencionist: string;
    Year: number;
    "Pitch Count": number;
    Latitude: number;
    Longitude: number;
    "StyleURL": string;
    "Topo URL": string;
    "Other URLs": string[];
    Extra: string;
};

type ActionData = { 
    error?: string; 
    success?: boolean;
    data?: RouteData[];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return { error: PERMISSION_ERROR };
    }
    return {};
}

export async function action({ request, context }: ActionFunctionArgs) {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return { error: PERMISSION_ERROR };
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
        return { error: "No file uploaded" };
    }

    try {
        const text = await file.text();
        console.log('File contents:', text);
        const data = JSON.parse(text) as RouteData[];
        console.log('Parsed data:', data);
        return { success: true, data };
    } catch (error) {
        console.error('Error processing file:', error);
        return { error: "Failed to parse JSON file" };
    }
}

export default function JsonImporter() {
    const fetcher = useFetcher<ActionData>();
    const [routes, setRoutes] = useState<RouteData[]>([]);

    // Log fetcher state changes
    useEffect(() => {
        console.log('Fetcher state changed:', fetcher.state);
        console.log('Fetcher data changed:', fetcher.data);
    }, [fetcher.state, fetcher.data]);

    // Log routes state changes
    useEffect(() => {
        console.log('Routes state changed:', routes);
        console.log('Routes length:', routes.length);
    }, [routes]);

    // Update routes when we get new data
    useEffect(() => {
        console.log('Checking fetcher data for routes update:', fetcher.data?.data);
        if (fetcher.data?.data) {
            console.log('Setting new routes:', fetcher.data.data);
            console.log('New routes length:', fetcher.data.data.length);
            setRoutes(fetcher.data.data);
        }
    }, [fetcher.data?.data]);

    const handleDrop = (files: File[]) => {
        const file = files[0];
        console.log('File dropped:', file?.type);
        if (file?.type === "application/json") {
            const formData = new FormData();
            formData.append("file", file);
            console.log('Submitting file...');
            fetcher.submit(formData, { 
                method: "post",
                encType: "multipart/form-data"
            });
        }
    };

    // Log render
    console.log('Rendering component with routes:', routes);
    console.log('Routes length during render:', routes.length);

    return (
        <RequirePermission access="admin">
            <Container size="lg" py="xl">
                <Paper radius="md" p="xl" withBorder>
                    <Stack gap="md">
                        <Alert
                            icon={<IconAlertCircle size={16} />}
                            title="🚧 Under Construction 🚧"
                            color="red"
                            variant="light"
                        >
                            This feature is still being developed. The JSON import functionality is not yet ready for use.
                        </Alert>

                        <div>
                            <Title order={2}>Import Route Data</Title>
                            <Text c="dimmed" size="sm">
                                Upload a JSON file containing route data to import
                            </Text>
                        </div>

                        <Dropzone
                            onDrop={handleDrop}
                            accept={['application/json']}
                            multiple={false}
                        >
                            <Group justify="center" gap="xl" mih={220} style={{ pointerEvents: 'none' }}>
                                <Dropzone.Accept>
                                    <IconUpload size={50} stroke={1.5} className="text-blue-500" />
                                </Dropzone.Accept>
                                <Dropzone.Reject>
                                    <IconX size={50} stroke={1.5} className="text-red-500" />
                                </Dropzone.Reject>
                                <Dropzone.Idle>
                                    <IconFile size={50} stroke={1.5} />
                                </Dropzone.Idle>

                                <div>
                                    <Text size="xl" inline>
                                        Drag a JSON file here or click to select
                                    </Text>
                                    <Text size="sm" c="dimmed" inline mt={7}>
                                        The file should contain an array of route objects
                                    </Text>
                                </div>
                            </Group>
                        </Dropzone>

                        {fetcher.data?.error && (
                            <Alert
                                icon={<IconAlertCircle size={16} />}
                                title="Error"
                                color="red"
                                variant="light"
                            >
                                {fetcher.data.error}
                            </Alert>
                        )}

                        {routes.length > 0 ? (
                            <Table>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Crag</Table.Th>
                                        <Table.Th>Sector</Table.Th>
                                        <Table.Th>Route</Table.Th>
                                        <Table.Th>Grade</Table.Th>
                                        <Table.Th>Latitude</Table.Th>
                                        <Table.Th>Longitude</Table.Th>
                                        <Table.Th>First Ascent</Table.Th>
                                        <Table.Th>Year</Table.Th>
                                        <Table.Th>Pitches</Table.Th>
                                        <Table.Th>Style</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {routes.map((route, index) => {
                                        console.log('Rendering route row:', route);
                                        return (
                                            <Table.Tr key={index}>
                                                <Table.Td>{route.Crag}</Table.Td>  
                                                <Table.Td>{route.Sector}</Table.Td>
                                                <Table.Td>{route.Route}</Table.Td>
                                                <Table.Td>
                                                    <Badge color="blue">{route.Difficulty}</Badge>
                                                </Table.Td>
                                                <Table.Td>{route.Latitude}</Table.Td>
                                                <Table.Td>{route.Longitude}</Table.Td>
                                                <Table.Td>{route.FirstAscencionist}</Table.Td>
                                                <Table.Td>{route.Year}</Table.Td>
                                                <Table.Td>{route["Pitch Count"]}</Table.Td>
                                                <Table.Td>{route["StyleURL"]}</Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        ) : (
                            <Text c="dimmed" ta="center">
                                No routes to display. Upload a JSON file to see the data.
                            </Text>
                        )}
                    </Stack>
                </Paper>
            </Container>
        </RequirePermission>
    );
}
