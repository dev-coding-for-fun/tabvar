import { Button, Container, Title } from "@mantine/core";
import { ActionFunction, LoaderFunction, json, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData } from "@remix-run/react";
import { Issue } from "kysely-codegen";
import { authenticator } from "~/lib/auth.server";
import { syncSloperData, syncSloperIssues } from "~/lib/sloper";

interface LoaderData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syncResult?: any;
}

export interface IssueWithRoute extends Issue {
    route_name: string;
    sector_name: string;
    crag_name: string;
}

export const loader: LoaderFunction = async ({ request }) => {  
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    return json({ });
}

export const action: ActionFunction = async({ request, context }) => {
    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    const formData = await request.formData();
    const action = formData.get("action");
    if (action == "sloper-datasync") {
        syncSloperData(context);
    }
    else if (action == "sloper-issuesync") {
        syncSloperIssues(context);
    }
    return redirect('/routes/manage');
}

export default function IssuesIndex() {
    const cragData = useLoaderData<LoaderData>();

    return (
        <Container size="xl" p="md">
            <Title order={1}>Manage Routes</Title>
            <Form method="post">
                <Button name="action" value="sloper-datasync" type="submit">Sync Route Data</Button>
                <Button name="action" value="sloper-issuesync" type="submit">Sync Issues</Button>
            </Form>
        </Container>
    );
}
