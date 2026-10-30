import { Container, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { data, Link, useLoaderData, type HeadersFunction, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getDB } from "~/lib/db";

export const meta: MetaFunction = () => [{ title: "Golden Crowbar voting results · TABVAR" }, { name: "robots", content: "noindex, nofollow" }];
export const headers: HeadersFunction = () => ({ "Cache-Control": "private, no-store" });

export async function loader(args: LoaderFunctionArgs) {
  const user = await requireUser(args);
  if (user.role !== "admin") throw new Response("Forbidden", { status: 403 });

  const db = getDB(args.context);
  const campaign = await db.selectFrom("campaign")
    .select(["id", "name", "end_date"])
    .where("name", "=", "2026 Golden Crowbar Award")
    .executeTakeFirst();
  if (!campaign) throw new Response("Campaign not found", { status: 404 });

  const candidates = await db.selectFrom("campaign_candidate as candidate")
    .leftJoin("vote", (join) => join
      .onRef("vote.campaign_candidate_id", "=", "candidate.id")
      .onRef("vote.campaign_id", "=", "candidate.campaign_id"))
    .select(["candidate.id", "candidate.name", db.fn.count<number>("vote.uid").as("votes")])
    .where("candidate.campaign_id", "=", campaign.id)
    .groupBy(["candidate.id", "candidate.name"])
    .orderBy("votes", "desc")
    .orderBy("candidate.name")
    .execute();
  return data({ campaign, candidates, total: candidates.reduce((sum, candidate) => sum + Number(candidate.votes), 0) }, { headers: { "Cache-Control": "private, no-store" } });
}

export default function GoldenCrowbarResults() {
  const { campaign, candidates, total } = useLoaderData<typeof loader>();
  return <Container size="md" py="xl">
    <Stack gap="lg">
      <Text><Link to="/goldencrowbar">← Back to the ballot</Link></Text>
      <div>
        <Text c="dimmed" size="sm">ADMINISTRATOR VIEW</Text>
        <Title order={1}>{campaign.name}: voting results</Title>
        <Text mt="xs">{total} {total === 1 ? "vote" : "votes"} recorded. Totals are visible to administrators only.</Text>
      </div>
      <Paper withBorder p="md">
        <Table striped>
          <Table.Thead><Table.Tr><Table.Th>Nominee</Table.Th><Table.Th ta="right">Votes</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{candidates.map((candidate) => <Table.Tr key={candidate.id}>
            <Table.Td>{candidate.name}</Table.Td><Table.Td ta="right">{Number(candidate.votes)}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  </Container>;
}
