import { Alert, Badge, Code, Container, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { RequirePermission } from "~/components/RequirePermission";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { privatePageMeta } from "~/lib/seo";

type SubmissionRow = {
  id: string;
  uid: string;
  client: string;
  status: string;
  kind: string;
  payload: string;
  createdAt: string;
  submitterName: string | null;
  submitterEmail: string | null;
};

type LoaderData = {
  error?: string;
  submissions: SubmissionRow[];
};

function prettyPayload(payload: string) {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("Topo submissions");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  if (user.role !== "admin" && user.role !== "super") {
    return data<LoaderData>({ error: PERMISSION_ERROR, submissions: [] }, { status: 403 });
  }

  const db = getDB(context);
  const submissions = await db.selectFrom("topo_submission")
    .leftJoin("user", "topo_submission.uid", "user.uid")
    .select([
      "topo_submission.id",
      "topo_submission.uid",
      "topo_submission.client",
      "topo_submission.status",
      "topo_submission.kind",
      "topo_submission.payload",
      "topo_submission.created_at as createdAt",
      "user.display_name as submitterName",
      "user.email as submitterEmail",
    ])
    .orderBy("topo_submission.created_at", "desc")
    .execute();

  return data<LoaderData>({ submissions });
}

export default function AdminSubmissions() {
  const { error, submissions } = useLoaderData<LoaderData>();

  return (
    <RequirePermission access="atLeastSuper">
      <Container size="100%" py="xl">
        <Stack gap="lg">
          <div>
            <Title order={2}>Topo Submissions</Title>
            <Text c="dimmed" size="sm">
              Quarantined TopoBuilder submissions. Approval tooling will be added later.
            </Text>
          </div>

          {error ? (
            <Alert title="Access denied" color="red">
              {error}
            </Alert>
          ) : null}

          {submissions.length === 0 ? (
            <Paper withBorder p="md">
              <Text c="dimmed">No topo submissions are queued.</Text>
            </Paper>
          ) : (
            <Table.ScrollContainer minWidth={1100}>
              <Table verticalSpacing="md" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Submission</Table.Th>
                    <Table.Th>Submitter</Table.Th>
                    <Table.Th>Payload</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {submissions.map((submission) => (
                    <Table.Tr key={submission.id}>
                      <Table.Td style={{ verticalAlign: "top", minWidth: 260 }}>
                        <Stack gap="xs">
                          <Text fw={600}>{submission.id}</Text>
                          <Group gap="xs">
                            <Badge>{submission.kind}</Badge>
                            <Badge color={submission.status === "pending" ? "yellow" : "gray"}>
                              {submission.status}
                            </Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {submission.client} · {submission.createdAt}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ verticalAlign: "top", minWidth: 220 }}>
                        <Stack gap={4}>
                          <Text>{submission.submitterName ?? submission.uid}</Text>
                          {submission.submitterEmail ? (
                            <Text size="sm" c="dimmed">{submission.submitterEmail}</Text>
                          ) : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ verticalAlign: "top" }}>
                        <Code block style={{ maxHeight: 500, overflow: "auto", whiteSpace: "pre-wrap" }}>
                          {prettyPayload(submission.payload)}
                        </Code>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Container>
    </RequirePermission>
  );
}
