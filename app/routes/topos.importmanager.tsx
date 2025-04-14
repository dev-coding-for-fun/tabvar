import { Container, Paper, Title, Stack, Text, Table, ActionIcon, Tooltip, Group, Badge, Button } from "@mantine/core";
import { type LoaderFunction, json, type ActionFunction } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { getDB } from "~/lib/db";
import { getAuthenticator } from "~/lib/auth.server";
import type { ImportNotes } from "~/lib/models";
import { DataTable } from "mantine-datatable";
import { format } from "date-fns";
import { IconDownload } from "@tabler/icons-react";
import { uploadAttachment } from "~/lib/attachment.server";
import { Link } from "@remix-run/react";
import { useState } from "react";

interface LoaderData {
    importNotes: (ImportNotes & {
        objectName: string | null;
    })[];
}

interface ActionData {
    success?: boolean;
    error?: string;
}

export const action: ActionFunction = async ({ request, context }) => {
    const user = await getAuthenticator(context).isAuthenticated(request);
    if (!user || user.role !== "admin") {
        return json<ActionData>({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const action = formData.get("_action") as string;

    switch (action) {
        case "download_and_attach": {
            const noteId = Number(formData.get("noteId"));
            const topoUrl = formData.get("topoUrl") as string;
            const cragId = Number(formData.get("cragId"));
            const sectorId = Number(formData.get("sectorId"));
            const routeId = Number(formData.get("routeId"));

            if (!noteId || !topoUrl) {
                return json<ActionData>({ error: "Missing required fields" }, { status: 400 });
            }

            const db = getDB(context);

            try {
                // Download the file
                const response = await fetch(topoUrl);
                if (!response.ok) {
                    // Update the import note with the error
                    await db
                        .updateTable("import_notes")
                        .set({ download_result: `${response.status}: ${response.statusText}` })
                        .where("id", "=", noteId)
                        .execute();
                    return json<ActionData>({ error: `Download failed: ${response.status} ${response.statusText}` }, { status: response.status });
                }

                const blob = await response.blob();
                if (blob.size === 0) {
                    await db
                        .updateTable("import_notes")
                        .set({ download_result: "0: Empty file" })
                        .where("id", "=", noteId)
                        .execute();
                    return json<ActionData>({ error: "Downloaded file is empty" }, { status: 400 });
                }

                // Extract filename from Content-Disposition header
                let filename = topoUrl.split('/').pop() || 'topo';
                const contentDisposition = response.headers.get('content-disposition');
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                    if (filenameMatch && filenameMatch[1]) {
                        filename = filenameMatch[1].replace(/['"]/g, '');
                    }
                }

                // Create a File object from the blob with the correct filename and type
                const file = new File([blob], filename, { 
                    type: filename.toLowerCase().endsWith('.pdf') 
                        ? 'application/pdf' 
                        : response.headers.get('content-type') || blob.type 
                });

                // Upload to R2 and create attachment
                const uploadResult = await uploadAttachment(
                    context,
                    file,
                    routeId ? [routeId] : [],
                    sectorId || 0,
                    cragId || 0
                );

                if (!uploadResult.success) {
                    // Update the import note with the upload error
                    await db
                        .updateTable("import_notes")
                        .set({ upload_result: uploadResult.error || "Unknown upload error" })
                        .where("id", "=", noteId)
                        .execute();
                    return json<ActionData>({ error: uploadResult.error }, { status: 400 });
                }

                // Update the import note with success
                await db
                    .updateTable("import_notes")
                    .set({ 
                        download_result: "200",
                        upload_result: "200"
                    })
                    .where("id", "=", noteId)
                    .execute();

                return json<ActionData>({ success: true });
            } catch (error) {
                console.error("Error processing topo:", error);
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                await db
                    .updateTable("import_notes")
                    .set({ 
                        download_result: `500: ${errorMessage}`,
                        upload_result: `500: ${errorMessage}`
                    })
                    .where("id", "=", noteId)
                    .execute();
                return json<ActionData>({ error: errorMessage }, { status: 500 });
            }
        }

        default:
            return json<ActionData>({ error: "Invalid action" }, { status: 400 });
    }
};

export const loader: LoaderFunction = async ({ request, context }) => {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });

    if (user.role !== "admin") {
        throw new Response("Unauthorized", { status: 401 });
    }

    const db = getDB(context);

    // Fetch all import notes with their associated objects
    const importNotes = await db
        .selectFrom("import_notes")
        .leftJoin("crag", "import_notes.crag_id", "crag.id")
        .leftJoin("sector", "import_notes.sector_id", "sector.id")
        .leftJoin("route", "import_notes.route_id", "route.id")
        .select([
            "import_notes.id",
            "import_notes.crag_id",
            "import_notes.sector_id",
            "import_notes.route_id",
            "import_notes.topo_url",
            "import_notes.notes",
            "import_notes.created_at",
            "import_notes.other_urls",
            "import_notes.download_result",
            "import_notes.upload_result",
            "crag.name as crag_name",
            "sector.name as sector_name",
            "route.name as route_name"
        ])
        .execute();

    // Transform the data to include the object name and ensure non-null values
    const transformedNotes = importNotes.map(note => ({
        id: note.id || 0,
        cragId: note.crag_id || null,
        sectorId: note.sector_id || null,
        routeId: note.route_id || null,
        topoUrl: note.topo_url || null,
        notes: note.notes || null,
        createdAt: note.created_at || null,
        otherUrls: note.other_urls || null,
        downloadResult: note.download_result || null,
        uploadResult: note.upload_result || null,
        objectName: note.route_name || note.sector_name || note.crag_name || null
    }));

    return json<LoaderData>({ importNotes: transformedNotes });
};

export default function ImportManager() {
    const { importNotes } = useLoaderData<LoaderData>();
    const fetcher = useFetcher<ActionData>();
    const [isProcessingAll, setIsProcessingAll] = useState(false);

    const convertGoogleDriveUrl = (url: string): string => {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname === 'drive.google.com') {
                // Extract the file ID from the path
                const match = urlObj.pathname.match(/\/file\/d\/([^/]+)/);
                if (match && match[1]) {
                    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
                }
            }
            return url;
        } catch {
            return url;
        }
    };

    const handleDownload = (note: ImportNotes & { objectName: string | null }) => {
        if (!note.topoUrl) return;

        const downloadUrl = convertGoogleDriveUrl(note.topoUrl);

        const formData = new FormData();
        formData.append("_action", "download_and_attach");
        formData.append("noteId", note.id.toString());
        formData.append("topoUrl", downloadUrl);
        if (note.cragId) formData.append("cragId", note.cragId.toString());
        if (note.sectorId) formData.append("sectorId", note.sectorId.toString());
        if (note.routeId) formData.append("routeId", note.routeId.toString());

        fetcher.submit(formData, { method: "post" });
    };

    const handleDownloadAll = async () => {
        setIsProcessingAll(true);
        
        // Filter to only process items that haven't succeeded
        const itemsToProcess = importNotes.filter(note => 
            note.topoUrl && note.uploadResult !== "200"
        );

        for (const note of itemsToProcess) {
            // Wait a bit between requests to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const downloadUrl = convertGoogleDriveUrl(note.topoUrl!);
            
            const formData = new FormData();
            formData.append("_action", "download_and_attach");
            formData.append("noteId", note.id.toString());
            formData.append("topoUrl", downloadUrl);
            if (note.cragId) formData.append("cragId", note.cragId.toString());
            if (note.sectorId) formData.append("sectorId", note.sectorId.toString());
            if (note.routeId) formData.append("routeId", note.routeId.toString());

            // Wait for the current download to complete before moving to the next
            await fetcher.submit(formData, { method: "post" });
        }
        
        setIsProcessingAll(false);
    };

    const getStatusBadge = (result: string | null | undefined) => {
        if (!result) return <Badge color="gray">Not started</Badge>;
        if (result === "200") return <Badge color="green">Success</Badge>;
        return <Badge color="red">{result}</Badge>;
    };

    return (
        <Container size="xl" py="xl">
            <Paper radius="md" p="xl" withBorder>
                <Stack gap="md">
                    <div>
                        <Title order={2}>Topos Import Manager</Title>
                        <Text c="dimmed" size="sm">
                            Manage imported topos and notes
                        </Text>
                    </div>

                    {fetcher.data?.error && (
                        <Text c="red" size="sm">
                            Error: {fetcher.data.error}
                        </Text>
                    )}

                    <Group justify="flex-end">
                        <Button
                            onClick={handleDownloadAll}
                            loading={isProcessingAll}
                            disabled={isProcessingAll || importNotes.every(note => note.uploadResult === "200")}
                        >
                            Download All
                        </Button>
                    </Group>

                    <DataTable
                        withTableBorder
                        borderRadius="sm"
                        withColumnBorders
                        striped
                        highlightOnHover
                        records={importNotes}
                        columns={[
                            {
                                accessor: 'id',
                                title: 'ID',
                                width: 80,
                            },
                            {
                                accessor: 'objectName',
                                title: 'Object',
                                width: 200,
                            },
                            {
                                accessor: 'createdAt',
                                title: 'Created',
                                width: 150,
                                render: ({ createdAt }) => 
                                    createdAt ? format(new Date(createdAt), 'MMM d, yyyy') : '-'
                            },
                            {
                                accessor: 'notes',
                                title: 'Notes',
                                width: 200,
                                render: ({ notes }) => notes || '-'
                            },
                            {
                                accessor: 'topoUrl',
                                title: 'Topo URL',
                                width: 300,
                                render: (note) => (
                                    <Group gap="xs" wrap="nowrap">
                                        <Tooltip label="Download and attach">
                                            <ActionIcon
                                                variant="light"
                                                color="blue"
                                                onClick={() => handleDownload(note)}
                                                loading={fetcher.state === "submitting"}
                                                disabled={!note.topoUrl}
                                            >
                                                <IconDownload size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                        {note.topoUrl ? (
                                            <Link
                                                to={note.topoUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    maxWidth: '250px',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    color: 'inherit',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {note.topoUrl}
                                            </Link>
                                        ) : (
                                            <Text>-</Text>
                                        )}
                                    </Group>
                                )
                            },
                            {
                                accessor: 'downloadResult',
                                title: 'Download Status',
                                width: 150,
                                render: ({ downloadResult }) => getStatusBadge(downloadResult)
                            },
                            {
                                accessor: 'uploadResult',
                                title: 'Upload Status',
                                width: 150,
                                render: ({ uploadResult }) => getStatusBadge(uploadResult)
                            }
                        ]}
                    />
                </Stack>
            </Paper>
        </Container>
    );
}
