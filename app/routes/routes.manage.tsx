import { Accordion, Button, Code, Container, Group, Stack, Text, Title } from "@mantine/core";
import { ActionFunction, LoaderFunction, json } from "@remix-run/cloudflare";
import { useFetcher } from "@remix-run/react";
import { Issue, User } from "kysely-codegen";
import { useEffect, useState } from "react";
import { authenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { syncSloperData, syncSloperIssues } from "~/lib/sloper";

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
    return json({ });
}

export const action: ActionFunction = async({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }

    const formData = await request.formData();
    const action = formData.get("action");
    let resultLog: string[] = [];
    if (action == "sloper-datasync") {
        resultLog = await syncSloperData(context);
    }
    else if (action == "sloper-issuesync") {
        resultLog = await syncSloperIssues(context);
    }
    return json( resultLog );
}

export default function ManageRoutes() {
    const fetcher = useFetcher<string[]>();
    const [logMessages, setLogMessages] = useState<string[]>([]);

    useEffect(() => {
        if (fetcher.data) {
            setLogMessages(fetcher.data);
        }
    }, [fetcher.data]);

    return (
        <Container size="xl" p="md">
            <Stack>
            <Title order={1}>Manage Routes</Title>
            <fetcher.Form method="post">
                <Group>
                    <Button name="action" value="sloper-datasync" type="submit">Sync Route Data</Button>
                    <Button name="action" value="sloper-issuesync" type="submit">Sync Issues</Button>
                </Group>
            </fetcher.Form>
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
