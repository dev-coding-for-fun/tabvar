import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Grid,
  Group,
  Image,
  List,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconDeviceMobile, IconUser } from "@tabler/icons-react";
import {
  data,
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { RequirePermission } from "~/components/RequirePermission";
import { RichTextViewer } from "~/components/RichTextViewer";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { privatePageMeta } from "~/lib/seo";
import type { SubmissionPayload } from "~/lib/submission.server";
import { approveSubmission, rejectSubmission, type ReviewResult } from "~/lib/submissionReview.server";
import {
  countConflicts,
  findConflicts,
  type ChangeConflicts,
  type ConflictCounts,
} from "~/lib/submissionConflicts.server";
import {
  countChanges,
  describeSubmissionChanges,
  type ChangeCounts,
  type ChangeView,
  type DisplayValue,
  type RecordRef,
} from "~/lib/submissionView.server";

const PAGE_PATH = "/admin/submissions";

type SubmissionSummary = {
  id: string;
  uid: string;
  source: string;
  error: string | null;
  createdAt: string;
  submitterName: string | null;
  submitterEmail: string | null;
  counts: ChangeCounts;
  conflictCounts: ConflictCounts;
};

type LoaderData = {
  error?: string;
  submissions: SubmissionSummary[];
  selected: { id: string; changes: ChangeView[]; conflicts: Record<number, ChangeConflicts> } | null;
};

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("Submissions");

export async function loader(args: LoaderFunctionArgs) {
  const user = await requireUser(args);
  if (user.role !== "admin" && user.role !== "super") {
    return data<LoaderData>({ error: PERMISSION_ERROR, submissions: [], selected: null }, { status: 403 });
  }

  const db = getDB(args.context);
  const rows = await db.selectFrom("submission")
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

  const queued = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    submitterName: row.submitterName,
    payload: JSON.parse(row.payload) as SubmissionPayload,
  }));
  // The queue is small, so every submission is checked to show conflict counts in the list.
  const conflictsById = new Map(await Promise.all(queued.map(async (submission) => [
    submission.id,
    await findConflicts(db, submission, queued.filter((other) => other.id !== submission.id)),
  ] as const)));

  const submissions = rows.map(({ payload: _payload, ...row }, index) => ({
    ...row,
    counts: countChanges(queued[index].payload),
    conflictCounts: countConflicts(conflictsById.get(row.id)!),
  }));

  const selectedId = new URL(args.request.url).searchParams.get("id");
  const selectedSubmission = queued.find((submission) => submission.id === selectedId);
  const selected = selectedSubmission
    ? {
      id: selectedSubmission.id,
      changes: await describeSubmissionChanges(db, selectedSubmission.payload),
      conflicts: Object.fromEntries(conflictsById.get(selectedSubmission.id)!),
    }
    : null;

  return { submissions, selected } satisfies LoaderData;
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
  if (!result.ok) {
    return data<ReviewResult>(result, { status: 409 });
  }

  // Move on to the next submission in the list.
  const next = await getDB(args.context).selectFrom("submission")
    .select("id")
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  return redirect(next ? `${PAGE_PATH}?id=${encodeURIComponent(next.id)}` : PAGE_PATH);
}

function countLabel({ creates, edits }: ChangeCounts) {
  const parts = [];
  if (creates) parts.push(`${creates} new`);
  if (edits) parts.push(`${edits} ${edits === 1 ? "edit" : "edits"}`);
  return parts.join(" · ");
}

function SourceBadge({ source }: { source: string }) {
  const Icon = source === "topobuilder" ? IconDeviceMobile : IconUser;
  return (
    <Badge variant="light" leftSection={<Icon size={12} aria-hidden />}>
      {source}
    </Badge>
  );
}

function SubmissionListItem({ submission, active }: { submission: SubmissionSummary; active: boolean }) {
  return (
    <UnstyledButton
      component={Link}
      to={`?id=${encodeURIComponent(submission.id)}`}
      aria-current={active ? "true" : undefined}
      w="100%"
    >
      <Paper withBorder p="sm" bg={active ? "var(--mantine-primary-color-light)" : undefined}>
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} truncate>{submission.submitterName ?? submission.uid}</Text>
            <SourceBadge source={submission.source} />
          </Group>
          <Text size="sm">{countLabel(submission.counts)}</Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">{submission.createdAt} UTC</Text>
            {submission.error ? <Badge size="xs" color="red">approval failed</Badge> : null}
            <ConflictBadges counts={submission.conflictCounts} />
          </Group>
        </Stack>
      </Paper>
    </UnstyledButton>
  );
}

function ConflictBadges({ counts }: { counts: ConflictCounts }) {
  return (
    <>
      {counts.conflicts > 0 ? (
        <Badge size="xs" color="orange">{counts.conflicts} {counts.conflicts === 1 ? "conflict" : "conflicts"}</Badge>
      ) : null}
      {counts.warnings > 0 ? <Badge size="xs" color="yellow" variant="light">record changed</Badge> : null}
    </>
  );
}

function plainValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function ConflictSection({ conflicts }: { conflicts: ChangeConflicts }) {
  const { fieldConflicts, overlaps, recordChanged } = conflicts;

  return (
    <Stack gap="xs">
      {fieldConflicts.length > 0 || overlaps.length > 0 ? (
        <Alert color="orange" title="Conflicts">
          <List size="sm" spacing={4}>
            {fieldConflicts.map((conflict, index) => (
              <List.Item key={`field-${index}`}>
                <Text span size="sm" fw={600}>{conflict.label}</Text> changed after the submitter last saw it:{" "}
                {plainValue(conflict.before)} → {plainValue(conflict.after)}, by {conflict.authorName ?? "an unknown user"}
                {conflict.reviewerName ? ` (approved by ${conflict.reviewerName})` : ""} at {conflict.at} UTC.
              </List.Item>
            ))}
            {overlaps.map((overlap) => (
              <List.Item key={`overlap-${overlap.submissionId}`}>
                {overlap.fields.join(", ")} {overlap.fields.length === 1 ? "is" : "are"} also edited in{" "}
                <Anchor component={Link} to={`?id=${encodeURIComponent(overlap.submissionId)}`} size="sm">
                  a submission from {overlap.submitterName ?? "another user"}
                </Anchor>.
              </List.Item>
            ))}
          </List>
        </Alert>
      ) : null}
      {recordChanged ? (
        <Alert color="yellow" variant="light" title="Record changed since submitted">
          <Text size="sm">
            {recordChanged.kind === "otherFields"
              ? `Other fields changed after the submitter last saw this record: ${recordChanged.fields.join(", ")}.`
              : `This record was updated at ${recordChanged.updatedAt} UTC by a change the audit log doesn't record, such as an import or a photo or topo link.`}
            {" "}It's unusual, so take a closer look.
          </Text>
        </Alert>
      ) : null}
    </Stack>
  );
}

function RecordName({ record }: { record: RecordRef }) {
  return record.isNew
    ? <Text span size="sm">New {record.entity} “{record.label}”</Text>
    : <Text span size="sm">{record.label} <Text span c="dimmed" size="xs">#{record.id}</Text></Text>;
}

function Value({ value }: { value: DisplayValue | undefined }) {
  if (!value || value.kind === "empty") {
    return <Text size="sm" c="dimmed">—</Text>;
  }
  switch (value.kind) {
    case "text":
      return <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{value.text}</Text>;
    case "richText":
      return <RichTextViewer content={value.html} />;
    case "record":
      return <RecordName record={value.record} />;
    case "image":
      return (
        <Anchor href={value.url} target="_blank" rel="noreferrer">
          <Image src={value.url} alt="" maw={240} radius="sm" />
        </Anchor>
      );
    case "annotations":
      return <Text size="sm">{value.count} {value.count === 1 ? "annotation" : "annotations"}</Text>;
    case "routes":
      return value.routes.length === 0 ? <Text size="sm" c="dimmed">None</Text> : (
        <List size="sm" spacing={2}>
          {value.routes.map((link, index) => (
            <List.Item key={index}>
              {link.label ? <Text span fw={600} size="sm">{link.label} · </Text> : null}
              <RecordName record={link.record} />
            </List.Item>
          ))}
        </List>
      );
  }
}

function ChangeCard({ change, conflicts }: { change: ChangeView; conflicts: ChangeConflicts | undefined }) {
  const isEdit = change.op === "update";
  const hasConflict = Boolean(conflicts && (conflicts.fieldConflicts.length > 0 || conflicts.overlaps.length > 0));

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <div>
          <Group gap="xs">
            <Badge color={isEdit ? "blue" : "green"} variant="light">{isEdit ? "Edit" : "New"}</Badge>
            <Text fw={600}>{change.title}</Text>
            {hasConflict ? <Badge color="orange">Conflict</Badge> : null}
          </Group>
          {change.location ? <Text size="sm" c="dimmed" mt={4}>{change.location}</Text> : null}
        </div>

        {conflicts ? <ConflictSection conflicts={conflicts} /> : null}

        {change.missing ? (
          <Alert color="red" title="Record not found">
            This {change.entity} no longer exists, so approving will fail.
          </Alert>
        ) : null}

        {change.fields.length > 0 ? (
          <Table.ScrollContainer minWidth={isEdit ? 480 : 320}>
            <Table verticalSpacing="xs">
              {isEdit ? (
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w="20%">Field</Table.Th>
                    <Table.Th>Current</Table.Th>
                    <Table.Th w={24} />
                    <Table.Th>Proposed</Table.Th>
                  </Table.Tr>
                </Table.Thead>
              ) : null}
              <Table.Tbody>
                {change.fields.map((field) => (
                  <Table.Tr key={field.name}>
                    <Table.Td style={{ verticalAlign: "top" }}>
                      <Text size="sm" fw={500}>{field.label}</Text>
                    </Table.Td>
                    {isEdit ? (
                      <>
                        <Table.Td style={{ verticalAlign: "top" }}><Value value={field.current} /></Table.Td>
                        <Table.Td style={{ verticalAlign: "top" }}>
                          <IconArrowRight size={14} aria-label="changes to" />
                        </Table.Td>
                      </>
                    ) : null}
                    <Table.Td style={{ verticalAlign: "top" }}><Value value={field.proposed} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : null}

        {isEdit && change.unchangedCount > 0 ? (
          <Text size="xs" c="dimmed">
            {change.unchangedCount} proposed {change.unchangedCount === 1 ? "field already matches" : "fields already match"} the current record.
          </Text>
        ) : null}
        {isEdit && change.fields.length === 0 && !change.missing ? (
          <Text size="sm" c="dimmed">Nothing would change.</Text>
        ) : null}
      </Stack>
    </Paper>
  );
}

function ReviewActions({ id, savedError }: { id: string; savedError: string | null }) {
  const fetcher = useFetcher<ReviewResult>();
  const busy = fetcher.state !== "idle";
  const intent = fetcher.formData?.get("intent");
  const actionError = !savedError && fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <>
      {savedError ? (
        <Alert color="red" title="The last approval attempt failed">
          {savedError} Changes made before the failure stay applied; approving again continues from there.
        </Alert>
      ) : actionError ? (
        <Alert color="red" title="Couldn't complete">{actionError}</Alert>
      ) : null}
      <fetcher.Form method="post" action={PAGE_PATH}>
        <input type="hidden" name="id" value={id} />
        <Group gap="xs">
          <Button type="submit" name="intent" value="approve" disabled={busy} loading={busy && intent === "approve"}>
            Approve
          </Button>
          <Button type="submit" name="intent" value="reject" color="red" variant="light" disabled={busy} loading={busy && intent === "reject"}>
            Reject
          </Button>
        </Group>
      </fetcher.Form>
    </>
  );
}

function SubmissionDetail({ submission, changes, conflicts }: {
  submission: SubmissionSummary;
  changes: ChangeView[];
  conflicts: Record<number, ChangeConflicts>;
}) {
  return (
    <Stack gap="md">
      <Anchor component={Link} to={PAGE_PATH} hiddenFrom="md" size="sm">
        <Group gap={4}><IconArrowLeft size={14} aria-hidden /> All submissions</Group>
      </Anchor>

      <Paper withBorder p="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={600}>{submission.submitterName ?? submission.uid}</Text>
              {submission.submitterEmail ? <Text size="sm" c="dimmed">{submission.submitterEmail}</Text> : null}
              <Text size="sm" c="dimmed">Submitted {submission.createdAt} UTC · {countLabel(submission.counts)}</Text>
            </div>
            <SourceBadge source={submission.source} />
          </Group>
          <ReviewActions key={submission.id} id={submission.id} savedError={submission.error} />
        </Stack>
      </Paper>

      {changes.map((change) => <ChangeCard key={change.index} change={change} conflicts={conflicts[change.index]} />)}
    </Stack>
  );
}

export default function AdminSubmissions() {
  const { error, submissions, selected } = useLoaderData<LoaderData>();
  const selectedSummary = selected ? submissions.find((submission) => submission.id === selected.id) : undefined;

  return (
    <RequirePermission access="atLeastSuper">
      <Container size="xl" py="xl">
        <Stack gap="lg">
          <div>
            <Title order={2}>Submissions</Title>
            <Text c="dimmed" size="sm">
              Proposed route data waiting for review. Approving writes the changes. Past decisions are in the audit log.
            </Text>
          </div>

          {error ? (
            <Alert title="Access denied" color="red">
              {error}
            </Alert>
          ) : null}

          {!error && submissions.length === 0 ? (
            <Paper withBorder p="md">
              <Text c="dimmed">No submissions are waiting for review.</Text>
            </Paper>
          ) : null}

          {submissions.length > 0 ? (
            <Grid gap="lg">
              <Grid.Col span={{ base: 12, md: 4 }} visibleFrom={selectedSummary ? "md" : undefined}>
                <Stack gap="xs">
                  {submissions.map((submission) => (
                    <SubmissionListItem key={submission.id} submission={submission} active={submission.id === selected?.id} />
                  ))}
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 8 }}>
                {selected && selectedSummary ? (
                  <SubmissionDetail submission={selectedSummary} changes={selected.changes} conflicts={selected.conflicts} />
                ) : (
                  <Paper withBorder p="md" visibleFrom="md">
                    <Text c="dimmed">Choose a submission to review.</Text>
                  </Paper>
                )}
              </Grid.Col>
            </Grid>
          ) : null}
        </Stack>
      </Container>
    </RequirePermission>
  );
}
