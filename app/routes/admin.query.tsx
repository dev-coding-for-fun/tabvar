import { ActionFunction, json, LoaderFunction } from "@remix-run/cloudflare";
import { Form, useActionData, useSubmit, useLoaderData, useFetcher } from "@remix-run/react";
import { Container, Stack, Title, Textarea, Button, Group, Alert, Table, Text, Code, FileButton, Space, LoadingOverlay } from "@mantine/core";
import { IconAlertCircle, IconDownload, IconUpload } from "@tabler/icons-react";
import { getAuthenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { RequirePermission } from "~/components/RequirePermission";
import { getDB } from "~/lib/db";
import type { User } from "~/lib/models";
import { useUser } from "~/lib/hooks/useUser";
import { useEffect } from "react";
import { notifications } from "@mantine/notifications";

// Keep export order as is for logical data presentation
const TABLES_TO_EXPORT = [
    'issue_attachment',
    'crag_attachment',
    'sector_attachment',
    'route_attachment',
    'external_issue_ref',
    'external_sector_ref',
    'external_crag_ref',
    'issue',
    'route',
    'sector',
    'crag'
] as const;

// Delete in reverse dependency order (children first)
const DELETE_ORDER = [
    'issue_attachment',
    'crag_attachment',
    'sector_attachment',
    'route_attachment',
    'external_issue_ref',
    'external_sector_ref',
    'external_crag_ref',
    'issue',
    'route',
    'sector',
    'crag'
] as const;

// Import in dependency order (parents first)
const IMPORT_ORDER = [
    'crag',
    'sector',
    'route',
    'issue',
    'external_crag_ref',
    'external_sector_ref',
    'external_issue_ref',
    'issue_attachment',
    'crag_attachment',
    'sector_attachment',
    'route_attachment'
] as const;

interface ActionData {
    success?: boolean;
    error?: string;
    rows?: Record<string, unknown>[];
    numRows?: number;
    columns?: string[];
    query?: string;
    exportData?: Record<string, any[]>;
    message?: string;
    importStats?: Record<string, number>;
    totalRows?: number;
}

export const loader: LoaderFunction = async ({ context }) => {
    const env = context.cloudflare.env as unknown as Env;
    return json({ environment: env.ENVIRONMENT });
};

export const action: ActionFunction = async ({ request, context }) => {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }

    const formData = await request.formData();
    const action = formData.get("_action");

    if (action === "export") {
        try {
            const db = getDB(context);
            const exportData: Record<string, any[]> = {};

            // Export each table
            for (const table of TABLES_TO_EXPORT) {
                const rows = await db
                    .selectFrom(table)
                    .selectAll()
                    .execute();
                exportData[table] = rows;
            }

            return json({ success: true, exportData });
        } catch (error) {
            console.error('Export error:', error);
            return json({
                error: `Export failed: ${error instanceof Error ? error.stack || error.message : String(error)}`,
            });
        }
    }

    if (action === "import") {
        try {
            const fileData = formData.get("file");
            if (!fileData || !(fileData instanceof File)) {
                return json({ error: "No file provided" });
            }

            const importData = JSON.parse(await fileData.text()) as Record<string, any[]>;
            const db = getDB(context);
            const importStats: Record<string, number> = {};
            let totalRows = 0;

            // Delete all data in a single statement to minimize foreign key issues
            const deleteStatement = DELETE_ORDER.map(table => 
                `DELETE FROM ${table}`
            ).join('; ');
            
            await db.executeQuery({
                sql: deleteStatement,
                parameters: []
            } as any);

            // Then import in dependency order (parents first)
            for (const table of IMPORT_ORDER) {
                if (importData[table]) {
                    // Reset the auto-increment sequence
                    await db.executeQuery({
                        sql: `DELETE FROM sqlite_sequence WHERE name = ?;`,
                        parameters: [table]
                    } as any);
                    
                    if (importData[table].length > 0) {
                        await db.executeQuery({
                            sql: `UPDATE sqlite_sequence SET seq = 0 WHERE name = ?;`,
                            parameters: [table]
                        } as any);
                        
                        // Insert one record at a time
                        for (const record of importData[table]) {
                            await db.insertInto(table).values(record).execute();
                        }
                        
                        // Update sequence
                        const maxId = Math.max(...importData[table].map(row => row.id || 0));
                        if (maxId > 0) {
                            await db.executeQuery({
                                sql: `UPDATE sqlite_sequence SET seq = ? WHERE name = ?;`,
                                parameters: [maxId, table]
                            } as any);
                        }

                        importStats[table] = importData[table].length;
                        totalRows += importData[table].length;
                    }
                }
            }

            // Rebuild the search index
            await db.executeQuery({
                sql: 'INSERT INTO route_search(route_search) VALUES("rebuild");',
                parameters: []
            } as any);

            // Create a detailed success message
            const tableStats = Object.entries(importStats)
                .filter(([_, count]) => count > 0)
                .map(([table, count]) => `${table}: ${count} rows`)
                .join('\n');

            return json({ 
                success: true, 
                message: `Database imported successfully.\nTotal rows imported: ${totalRows}\n\nDetails:\n${tableStats}`,
                importStats,
                totalRows
            });
        } catch (error) {
            console.error('Import error:', error);
            return json({
                error: error instanceof Error ? error.stack || error.message : String(error),
            });
        }
    }

    const queryString = formData.get("query")?.toString();
    if (!queryString) {
        return json({ error: "No query provided" });
    }

    try {
        const db = getDB(context);
        const result = await db.executeQuery({
            sql: queryString,
            parameters: []
        } as any);

        const { rows } = result;
        return json({
            success: true,
            rows,
            numRows: rows.length,
            columns: rows && rows.length > 0 ? Object.keys(rows[0] as object) : [],
            query: queryString
        });
    } catch (error) {
        console.error('Query error:', error);
        return json({
            error: error instanceof Error ? error.stack || error.message : String(error),
            query: queryString
        });
    }
};

export default function AdminQuery() {
    const user = useUser();
    const submit = useSubmit();
    const fetcher = useFetcher<ActionData>();
    const { environment } = useLoaderData<{ environment: string }>();
    const actionData = useActionData<ActionData>();

    const handleExport = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const formData = new FormData();
        formData.set('_action', 'export');
        submit(formData, { method: 'post' });
    };

    const handleImport = async (file: File | null) => {
        if (!file) return;
        const formData = new FormData();
        formData.set('_action', 'import');
        formData.set('file', file);
        fetcher.submit(formData, { 
            method: 'post',
            encType: 'multipart/form-data'
        });
    };

    // Handle download when export data is received
    useEffect(() => {
        if (actionData?.exportData) {
            const jsonString = JSON.stringify(actionData.exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'database_export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }, [actionData?.exportData]);

    // Show notifications for import results
    useEffect(() => {
        if (fetcher.data?.error) {
            notifications.show({
                title: 'Error',
                message: fetcher.data.error,
                color: 'red'
            });
        } else if (fetcher.data?.success) {
            notifications.show({
                title: 'Success',
                message: `Database imported successfully. ${fetcher.data.totalRows} rows imported.`,
                color: 'green'
            });
        }
    }, [fetcher.data]);

    return (
        <RequirePermission access="admin">
            <Container size="xl">
                <Stack>
                    <Title order={1}>SQL Query Tool</Title>
                    <Alert
                        icon={<IconAlertCircle size="1rem" />}
                        title="Warning"
                        color="yellow"
                    >
                        This tool allows running raw SQL queries. Use with caution as queries can modify or delete data.
                    </Alert>

                    <Stack pos="relative">
                        <LoadingOverlay 
                            visible={fetcher.state !== 'idle'} 
                            zIndex={1000}
                            overlayProps={{ radius: "sm", blur: 2 }}
                        />
                        <Group>
                            <Button
                                onClick={handleExport}
                                leftSection={<IconDownload size={14} />}
                            >
                                Export Database
                            </Button>
                            {environment !== 'production' && (
                                <FileButton
                                    onChange={handleImport}
                                    accept=".json"
                                    disabled={fetcher.state !== 'idle'}
                                >
                                    {(props) => (
                                        <Button
                                            {...props}
                                            leftSection={<IconUpload size={14} />}
                                            loading={fetcher.state !== 'idle'}
                                        >
                                            Import Database
                                        </Button>
                                    )}
                                </FileButton>
                            )}
                        </Group>
                        <Form method="post" style={{ flex: 1 }}>
                            <Stack>
                                <Textarea
                                    name="query"
                                    label="SQL Query"
                                    placeholder="SELECT * FROM route LIMIT 10"
                                    minRows={5}
                                    required
                                    defaultValue={actionData?.query}
                                />
                                <Button type="submit" name="_action" value="query">
                                    Run Query
                                </Button>
                            </Stack>
                        </Form>
                    </Stack>

                    {fetcher.data?.error && (
                        <Alert title="Error" color="red">
                            <Code block>{fetcher.data.error}</Code>
                        </Alert>
                    )}

                    {fetcher.data?.message && fetcher.data.importStats ? (
                        <Alert title="Import Successful" color="green">
                            <Text>Total rows imported: {fetcher.data.totalRows}</Text>
                            <Space h="sm" />
                            <Text fw={500}>Details:</Text>
                            <Table>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Table</Table.Th>
                                        <Table.Th>Rows Imported</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {Object.entries(fetcher.data.importStats)
                                        .filter(([_, count]) => count > 0)
                                        .map(([table, count]) => (
                                            <Table.Tr key={table}>
                                                <Table.Td>{table}</Table.Td>
                                                <Table.Td>{count}</Table.Td>
                                            </Table.Tr>
                                        ))}
                                </Table.Tbody>
                            </Table>
                        </Alert>
                    ) : actionData?.message ? (
                        <Alert title="Success" color="green">
                            {actionData.message}
                        </Alert>
                    ) : null}

                    {actionData?.success && !actionData.exportData && !fetcher.data?.importStats && (
                        <Stack>
                            <Text>Rows affected: {actionData.numRows}</Text>
                            {actionData.rows && actionData.rows.length > 0 && (
                                <Table striped highlightOnHover withTableBorder withColumnBorders>
                                    <Table.Thead>
                                        <Table.Tr>
                                            {actionData.columns?.map((column) => (
                                                <Table.Th key={column}>{column}</Table.Th>
                                            ))}
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {actionData.rows.map((row, index) => (
                                            <Table.Tr key={index}>
                                                {actionData.columns?.map((column) => (
                                                    <Table.Td key={column}>
                                                        {row[column] === null ?
                                                            <Text c="dimmed">null</Text> :
                                                            String(row[column])
                                                        }
                                                    </Table.Td>
                                                ))}
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Stack>
                    )}
                </Stack>
            </Container>
        </RequirePermission>
    );
} 