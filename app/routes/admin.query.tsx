import { ActionFunction, data } from "@remix-run/cloudflare";
import { Form, useActionData } from "@remix-run/react";
import { Container, Stack, Title, Textarea, Button, Table, Text, Code, Alert } from "@mantine/core";
import { getAuthenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { User } from "~/lib/db.d";
import { getDB } from "~/lib/db";
import { IconAlertCircle } from "@tabler/icons-react";
import { useUser } from "~/lib/hooks/useUser";
import { RequirePermission } from "~/components/RequirePermission";

export const action: ActionFunction = async ({ request, context }) => {
    const user: Partial<User> = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return data({ error: PERMISSION_ERROR }, { status: 403 });
    }

    const formData = await request.formData();
    const queryString = formData.get("query")?.toString();

    if (!queryString) {
        return data({ error: "No query provided" });
    }

    try {
        const db = getDB(context);
        const result = await db.executeQuery({
            sql: queryString,
            parameters: []
        } as any);

        const { rows } = result;
        return data({
            success: true,
            rows,
            numRows: rows.length,
            columns: rows && rows.length > 0 ? Object.keys(rows[0] as object) : [],
            query: queryString
        });
    } catch (error) {
        return data({
            error: error instanceof Error ? error.message : "Unknown error occurred",
            query: queryString
        });
    }
};

export default function AdminQuery() {
    const user = useUser();
    const actionData = useActionData<{
        success?: boolean;
        error?: string;
        rows?: Record<string, unknown>[];
        numRows?: number;
        columns?: string[];
        query?: string;
    }>();

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

                    <Form method="post">
                        <Stack>
                            <Textarea
                                name="query"
                                label="SQL Query"
                                placeholder="SELECT * FROM route LIMIT 10"
                                minRows={5}
                                required
                                defaultValue={actionData?.query}
                            />
                            <Button type="submit">Run Query</Button>
                        </Stack>
                    </Form>

                    {actionData?.error && (
                        <Alert title="Error" color="red">
                            <Code block>{actionData.error}</Code>
                        </Alert>
                    )}

                    {actionData?.success && (
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