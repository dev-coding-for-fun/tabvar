import { Form, useActionData, useNavigation, useSearchParams, useLoaderData, data } from "@remix-run/react";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    TextInput,
    Button,
    Paper,
    Title,
    Container,
    Stack,
    Alert,
    Text
} from "@mantine/core";
import { IconDownload, IconAlertCircle } from "@tabler/icons-react";
import { getDB } from "~/lib/db";
import { RequirePermission } from "~/components/RequirePermission";

type ActionData = { error?: string; success?: true };

type LoaderData = {
    name: string;
    type: 'crag' | 'sector';
};

export async function loader({ request, context }: ActionFunctionArgs) {
    const url = new URL(request.url);
    const cragId = url.searchParams.get("cragId");
    const sectorId = url.searchParams.get("sectorId");
    const db = getDB(context);

    if (!cragId && !sectorId) {
        throw redirect("/");
    }

    if (cragId) {
        const crag = await db.selectFrom('crag')
            .select('name')
            .where('id', '=', parseInt(cragId))
            .executeTakeFirst();

        if (!crag) {
            throw new Response("Crag not found", { status: 404 });
        }

        return data<LoaderData>({ name: crag.name, type: 'crag' });
    }

    if (sectorId) {
        const sector = await db.selectFrom('sector')
            .select('name')
            .where('id', '=', parseInt(sectorId))
            .executeTakeFirst();

        if (!sector) {
            throw new Response("Sector not found", { status: 404 });
        }

        return data<LoaderData>({ name: sector.name, type: 'sector' });
    }

    throw new Response("Invalid request", { status: 400 });
}

export async function action({ request, context }: ActionFunctionArgs) {
    const url = (await request.formData()).get("url");
    if (!url || typeof url !== "string") {
        return { error: "URL is required" };
    }

    try {
        await (await fetch(url)).text();

        const ai = new GoogleGenerativeAI(context.cloudflare.env.GEMINI_API_KEY);

        const model = ai.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction: "You are a data analyst specializing in the organization of data for rock climbing routes.  You will be provided with an external html page containing information about a crag and its routes, to be used for comparison against an existing internal database.  Crags are generally, but not always made up of areas or sectors that in turn have a number of routes.\n\nYour task is to find all differences, spot missing routes or cases where the names are slightly different, and otherwise compare all data to ensure consistency.  \n\nThe order of the routes is very important.  In the database, this is determined by the sortOrder, while in the external html it will usually just be the order of appearance.  If there are numbers, the numbers themselves aren't important, just the ordering.\n\nSometimes, different units of measurement or climbing grade systems may be used, and you will need to translate them to fit the internal database.\n\nSometimes the name of the sector or area that the routes belong to will differ, but you will be able to tell they are meant to be the same by the routes inside.\n\nUse your intelligence to figure out what's actually new, what's just different, and what might be out of sync.  Do this for the crag itself, the sector or areas within, and the routes within that.\n\nBuild a nice clean comparison of each object (crag, sector, route) that's off.\n\nThe database contains the following fields, anything other than these can be ignored:\nCrag: name, latitude, longitude\nSector: name, latitude, longitude, sort order\nRoute: name, altNames, boltCount, climbStyle, firstAscentBy, firstAscentDate, gradeYds, pitchCount, routeBuiltDate, routeLength, sortOrder\n\nValid values for climbStyle: ['Sport', 'Trad', 'Boulder', 'Mixed Rock', 'Mixed Ice', 'Ice', 'Aid']\nGradeYds can accept other types depending on climb style:\nSport, Mixed Rock, Trad = ['5.0', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8', '5.9', '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b']\nIce = ['WI1', 'WI2', 'WI3', 'WI4', 'WI5', 'WI6', 'WI7']\nBoulder = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16']\nMixed Ice = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16']\nAid = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']",
        });

        const generationConfig = {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            responseModalities: [
            ],
            responseMimeType: "application/json",
        };



        return { success: true };
    } catch {
        return { error: "Failed to fetch URL" };
    }
}

export default function ToposImporter() {
    const { state } = useNavigation();
    const actionData = useActionData<ActionData>();
    const { name, type } = useLoaderData<LoaderData>();

    return (
        <RequirePermission access="admin">
            <Container size="sm" py="xl">
                <Paper radius="md" p="xl" withBorder>
                    <Stack gap="md">
                        <Alert
                            icon={<IconAlertCircle size={16} />}
                            title="🚧 Under Construction 🚧"
                            color="red"
                            variant="light"
                        >
                            This feature is still being developed. The AI-powered data import functionality is not yet ready for use.
                        </Alert>

                        <div>
                            <Title order={2}>Import Crag Data</Title>
                            <Text c="dimmed" size="sm">
                                Importing data for {type === 'crag' ? 'Crag' : 'Sector'}: {name}
                            </Text>
                        </div>

                        <Form method="post">
                            <Stack gap="md">
                                <TextInput
                                    label="Source URL"
                                    name="url"
                                    placeholder="https://example.com/crag"
                                    required
                                    description="Enter the URL of the page containing the crag data"
                                />

                                {actionData?.error && (
                                    <Alert
                                        icon={<IconAlertCircle size={16} />}
                                        title="Error"
                                        color="red"
                                        variant="light"
                                    >
                                        {actionData.error}
                                    </Alert>
                                )}

                                <Button
                                    type="submit"
                                    loading={state === "submitting"}
                                    leftSection={<IconDownload size={16} />}
                                    variant="light"
                                    color="blue"
                                    size="md"
                                >
                                    {state === "submitting" ? "Fetching..." : "Fetch Data"}
                                </Button>
                            </Stack>
                        </Form>
                    </Stack>
                </Paper>
            </Container>
        </RequirePermission>
    );
}
