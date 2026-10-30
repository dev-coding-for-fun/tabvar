import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Alert, Anchor, Badge, Button, Container, Group, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { IconArrowDown, IconArrowRight, IconCheck, IconCircleCheckFilled } from "@tabler/icons-react";
import { sql } from "kysely";
import nomineeCopy from "../../docs/golden-crowbar-2026-nominees.md?raw";
import { CROWBAR_GOLD, GoldenCrowbarHero } from "~/components/GoldenCrowbarHero";
import { getSessionUser, requireUser } from "~/lib/auth.server";
import { getDB } from "~/lib/db";
import { publicPageMeta } from "~/lib/seo";

const CAMPAIGN_NAME = "2026 Golden Crowbar Award";

// The Markdown is the editorial source of truth; the database holds ballot IDs only.
const [preamble, ...nomineeSections] = nomineeCopy.split(/^## /m);
const intro = preamble.replace(/^# .*$/m, "").trim();
const nominees = nomineeSections.map((section) => {
  const [name, ...description] = section.trim().split("\n");
  return { name, description: description.join("\n").trim() };
});

export const meta: MetaFunction = () => publicPageMeta({
  titlePhrase: "Golden Crowbar 2026",
  description: "Meet the 2026 Golden Crowbar nominees and vote for the routebuilders who make climbing in the Bow Valley possible.",
  pathname: "/goldencrowbar",
});

export const headers: HeadersFunction = () => ({ "Cache-Control": "private, no-store" });

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await getSessionUser(request, context);
  const db = getDB(context);
  const campaign = await db.selectFrom("campaign")
    .select(["id", "end_date", sql<number>`datetime(end_date) > datetime('now')`.as("is_open")])
    .where("name", "=", CAMPAIGN_NAME)
    .executeTakeFirst();

  if (!campaign) {
    return data({ nominees: nominees.map((nominee) => ({ ...nominee, id: null })), deadline: null, isOpen: false, ready: false, signedIn: !!user, canViewResults: user?.role === "admin", vote: null }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const candidates = await db.selectFrom("campaign_candidate")
    .select(["id", "name"])
    .where("campaign_id", "=", campaign.id)
    .execute();
  const ballot = nominees.map((nominee) => {
    const matches = candidates.filter((candidate) => candidate.name === nominee.name);
    return { ...nominee, id: matches.length === 1 ? matches[0].id : null };
  });
  const vote = user ? await db.selectFrom("vote")
    .select("campaign_candidate_id")
    .where("campaign_id", "=", campaign.id)
    .where("uid", "=", user.uid)
    .executeTakeFirst() : undefined;

  return data({
    nominees: ballot,
    deadline: formatDeadline(campaign.end_date),
    isOpen: Boolean(campaign.is_open),
    ready: ballot.every((nominee) => nominee.id !== null),
    signedIn: !!user,
    canViewResults: user?.role === "admin",
    vote: vote?.campaign_candidate_id ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function action(args: ActionFunctionArgs) {
  const user = await requireUser(args);
  const form = await args.request.formData();
  const candidateValue = form.get("candidateId");
  if (typeof candidateValue !== "string" || !/^[1-9]\d*$/.test(candidateValue) || !Number.isSafeInteger(Number(candidateValue))) {
    return data({ error: "Choose a nominee before casting your vote." }, { status: 400 });
  }

  const db = getDB(args.context);
  // One atomic statement enforces the deadline, candidate's campaign, and one vote per account.
  const result = await sql<{ campaign_candidate_id: number }>`
    INSERT INTO vote (campaign_id, uid, campaign_candidate_id)
    SELECT campaign.id, ${user.uid}, campaign_candidate.id
    FROM campaign
    JOIN campaign_candidate ON campaign_candidate.campaign_id = campaign.id
    WHERE campaign.name = ${CAMPAIGN_NAME}
      AND campaign_candidate.id = ${Number(candidateValue)}
      AND campaign_candidate.name IN (${sql.join(nominees.map((nominee) => sql`${nominee.name}`))})
      AND (SELECT count(*) FROM campaign_candidate eligible
           WHERE eligible.campaign_id = campaign.id
             AND eligible.name IN (${sql.join(nominees.map((nominee) => sql`${nominee.name}`))})) = ${nominees.length}
      AND (SELECT count(DISTINCT eligible.name) FROM campaign_candidate eligible
           WHERE eligible.campaign_id = campaign.id
             AND eligible.name IN (${sql.join(nominees.map((nominee) => sql`${nominee.name}`))})) = ${nominees.length}
      AND datetime(campaign.end_date) > datetime('now')
    ON CONFLICT (campaign_id, uid) DO NOTHING
    RETURNING campaign_candidate_id
  `.execute(db);

  if (!result.rows.length) {
    return data({ error: "Your vote could not be recorded. The ballot may be unavailable, voting may have closed, or you may have already voted." }, { status: 409 });
  }
  return { success: true };
}

function Description({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(https:\/\/app\.tabvar\.org\/topos[^)]+\))/g);
  return <>{parts.map((part, index) => {
    const match = /^\[([^\]]+)\]\((https:\/\/app\.tabvar\.org\/topos[^)]+)\)$/.exec(part);
    return match ? <a key={index} href={match[2]}>{match[1]}</a> : part;
  })}</>;
}

function formatDeadline(value: string) {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

export default function GoldenCrowbar() {
  const { nominees: ballot, deadline, isOpen, ready, signedIn, canViewResults, vote } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<number | null>(vote);
  const statusRef = useRef<HTMLDivElement>(null);
  const voting = ready && isOpen && signedIn && vote === null;
  const votedFor = ballot.find((nominee) => nominee.id === vote);
  const selectedNominee = ballot.find((nominee) => nominee.id === selected);
  const submitting = navigation.state !== "idle";

  // The vote is cast from the floating bar near the bottom of the page; bring the outcome into view.
  useEffect(() => {
    if (actionData) statusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [actionData]);

  const status = <Paper withBorder radius="md" p="lg" shadow="xs" className="crowbar-status">
    <Group gap={8} wrap="nowrap">
      <span className={`crowbar-dot${ready && isOpen ? " is-open" : ""}`} aria-hidden="true" />
      <Text fw={800} size="lg">{!ready ? "Ballot coming soon" : isOpen ? "Voting is open" : "Voting is closed"}</Text>
    </Group>
    {deadline && <Text size="sm" c="dimmed" mt={4}>{isOpen ? "Closes" : "Closed"} {deadline} MT</Text>}
    <div ref={statusRef} role="status">
      {!ready && <Text size="sm" mt="md">The ballot is being prepared. Please check back soon.</Text>}
      {ready && !isOpen && vote === null && <Text size="sm" mt="md">Thank you for celebrating this year&apos;s routebuilders.</Text>}
      {votedFor && <Group gap={8} mt="md" wrap="nowrap" align="flex-start" className="crowbar-voted">
        <IconCircleCheckFilled size={20} />
        <Text size="sm" fw={600}>Your vote for {votedFor.name} has been recorded. Thank you for voting!</Text>
      </Group>}
      {actionData && "error" in actionData && <Alert color="red" variant="light" mt="md" p="sm">{actionData.error}</Alert>}
    </div>
    {ready && isOpen && vote === null && <Text size="sm" mt="md">One vote per signed-in account. Once cast, your vote is final.</Text>}
    {ready && isOpen && !signedIn && <Button component={Link} to="/login?redirectTo=%2Fgoldencrowbar" fullWidth mt="md" color={CROWBAR_GOLD} autoContrast>Sign in to vote</Button>}
    {voting && <Button component="a" href="#nominees" fullWidth mt="md" variant="default" rightSection={<IconArrowDown size={16} />}>Choose a nominee</Button>}
    {canViewResults && <Anchor component={Link} to="/goldencrowbar/results" size="sm" mt="md" display="inline-block">View voting results</Anchor>}
  </Paper>;

  return <main className="crowbar-page">
    <GoldenCrowbarHero year={2026} intro={intro} aside={status} />

    <Container size="lg" py={48}>
      <Form method="post">
        <div id="nominees" className="crowbar-section-heading">
          <Title order={2}>The nominees</Title>
          <Text c="dimmed" mt={4}>{voting ? "Select one nominee, then cast your vote." : `${ballot.length} nominees for 2026.`}</Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {ballot.map((nominee) => {
            const selectable = voting && nominee.id !== null;
            const classes = ["crowbar-card", selectable && "is-selectable", selectable && selected === nominee.id && "is-selected", vote !== null && vote === nominee.id && "is-voted"];
            return <article className={classes.filter(Boolean).join(" ")} key={nominee.name}>
              <div className="crowbar-card-head">
                <Title order={3} fz="lg" fw={800}>{nominee.name}</Title>
                {selectable && <>
                  {/* Stretched over the card so a click anywhere but a topo link selects the nominee. */}
                  <input type="radio" className="crowbar-card-input" name="candidateId" aria-label={`Vote for ${nominee.name}`} value={nominee.id ?? ""} checked={selected === nominee.id} onChange={() => setSelected(nominee.id)} required />
                  <span className="crowbar-radio" aria-hidden="true"><IconCheck size={14} stroke={3} /></span>
                </>}
                {vote !== null && vote === nominee.id && <Badge color={CROWBAR_GOLD} autoContrast leftSection={<IconCheck size={12} stroke={3} />}>Your vote</Badge>}
              </div>
              <Text className="crowbar-card-text"><Description text={nominee.description} /></Text>
            </article>;
          })}
        </SimpleGrid>

        {voting && <Paper className="crowbar-votebar" shadow="lg" radius="md" p="md">
          <div>
            <Text size="xs" c="dimmed" fw={700}>Your choice</Text>
            <Text fw={800}>{selectedNominee?.name ?? "None selected"}</Text>
          </div>
          <Button type="submit" size="md" color={CROWBAR_GOLD} autoContrast disabled={!selectedNominee} loading={submitting} rightSection={<IconArrowRight size={18} />}>Cast my vote</Button>
        </Paper>}
      </Form>

      <Paper withBorder radius="md" p="lg" mt={56} className="crowbar-archive">
        <div>
          <Text size="sm" c="dimmed" fw={700}>Previous winners</Text>
          <Text fw={800} size="lg">Golden Crowbar 2025</Text>
          <Text size="sm" mt={2}>Matt Laird &amp; Andrew Slootweg took the award, with Dan Padeanu as runner-up.</Text>
        </div>
        <Button component={Link} to="/goldencrowbar/2025" variant="default" rightSection={<IconArrowRight size={16} />}>Explore the 2025 award</Button>
      </Paper>
    </Container>
  </main>;
}
