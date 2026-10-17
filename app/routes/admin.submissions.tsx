import { Alert, Badge, Button, Code, Container, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import {
  data,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { RequirePermission } from "~/components/RequirePermission";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { privatePageMeta } from "~/lib/seo";
import { approveSubmission, rejectSubmission, type ReviewResult } from "~/lib/submissionReview.server";

type SubmissionRow = {
  id: string;
  uid: string;
  source: string;
  payload: string;
  error: string | null;
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

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("Submissions");

export async function loader(args: LoaderFunctionArgs) {
  const user = await requireUser(args);
  if (user.role !== "admin" && user.role !== "super") {
    return data<LoaderData>({ error: PERMISSION_ERROR, submissions: [] }, { status: 403 });
  }

  const db = getDB(args.context);
  const submissions = await db.selectFrom("submission")
    .leftJoin("user", "submission.uid", "user.uid")
    .select([
      "submission.id",
      "submission.uid",
      "submission.source",
      "submission.payload",
      "submission.error",
      "submission.created_at as createdAt",
      "user.display_name as submitterName",
      "user.email as submitterEmail",
    ])
    .orderBy("submission.created_at", "desc")
    .execute();

  return data<LoaderData>({ submissions });
}

export async function action(args: ActionFunctionArgs) {
  const user = await requireUser(args);
  if (user.role !== "admin" && user.role !== "super") {
    return data<ReviewResult>({ ok: false, error: PERMISSION_ERROR }, { status: 403 });
  }

  const formData = await args.request.formData();
  const id = formData.get("id")?.toString();
  const intent = formData.get("intent");
  if (!id || (intent !== "approve" && intent !== "reject")) {
    return data<ReviewResult>({ ok: false, error: "Choose approve or reject for a submission." }, { status: 400 });
  }

  const review = intent === "approve" ? approveSubmission : rejectSubmission;
  const result = await review(args.context, { id, reviewer: user });
  return data<ReviewResult>(result, { status: result.ok ? 200 : 409 });
}

function ReviewActions({ id, error }: { id: string; error: string | null }) {
  const fetcher = useFetcher<ReviewResult>();
  const busy = fetcher.state !== "idle";
  const intent = fetcher.formData?.get("intent");
  const shownError = fetcher.data && !fetcher.data.ok ? fetcher.data.error : error;

  return (
    <Stack gap="xs">
      <fetcher.Form method="post">
        <input type="hidden" name="id" value={id} />
        <Group gap="xs">
          <Button type="submit" name="intent" value="approve" size="xs" disabled={busy} loading={busy && intent === "approve"}>
            Approve
          </Button>
          <Button type="submit" name="intent" value="reject" size="xs" color="red" variant="light" disabled={busy} loading={busy && intent === "reject"}>
            Reject
          </Button>
        </Group>
      </fetcher.Form>
      {shownError ? (
        <Text size="sm" c="red">Approval failed: {shownError}</Text>
      ) : null}
    </Stack>
  );
}

export default function AdminSubmissions() {
  const { error, submissions } = useLoaderData<LoaderData>();

  return (
    <RequirePermission access="atLeastSuper">
      <Container size="100%" py="xl">
        <Stack gap="lg">
          <div>
            <Title order={2}>Submissions</Title>
            <Text c="dimmed" size="sm">
              Queued submissions waiting for review. Approving writes the changes; decisions are kept in the audit log.
            </Text>
          </div>

          {error ? (
            <Alert title="Access denied" color="red">
              {error}
            </Alert>
          ) : null}

          {submissions.length === 0 ? (
            <Paper withBorder p="md">
              <Text c="dimmed">No submissions are queued.</Text>
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
                            <Badge>{submission.source}</Badge>
                            {submission.error ? <Badge color="red">approval failed</Badge> : null}
                          </Group>
                          <Text size="sm" c="dimmed">{submission.createdAt}</Text>
                          <ReviewActions id={submission.id} error={submission.error} />
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
