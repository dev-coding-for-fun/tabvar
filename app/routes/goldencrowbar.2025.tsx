import { Anchor, Badge, Container, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconMedal, IconTrophy } from "@tabler/icons-react";
import { Link, type MetaFunction } from "react-router";
import { CROWBAR_GOLD, GoldenCrowbarHero } from "~/components/GoldenCrowbarHero";
import { publicPageMeta } from "~/lib/seo";

const GOLDCROW_DESC =
  "Announcing the winners of the 2025 Golden Crowbar Award, recognizing outstanding contributions to the Bow Valley's climbing community.";

export const meta: MetaFunction = () => {
  return publicPageMeta({
    titlePhrase: "Golden Crowbar 2025",
    description: GOLDCROW_DESC,
    pathname: "/goldencrowbar/2025",
  });
};

const WINNERS = [
  {
    name: "Matt Laird & Andrew Slootweg",
    result: 1,
    routes: [
      "Matt Laird & Andrew Slootweg: <a href='https://app.tabvar.org/topos/127#route-3685' target='_blank' >Bastion – 5.10c</a>, 10 pitch bolted route on Lookout Tower, Castle Mountain",
      "Matt Laird: <a href='https://app.tabvar.org/topos/199#route-3670' target='_blank'>Creature from the Black Lagoon – 5.11a</a>, 4 pitch bolted route on Mount McGillivray",
      "Matt Laird: <a href='https://app.tabvar.org/topos/98#route-3780' target='_blank'>Macaroon – 5.10d</a>, 3 pitch route on Armadillo Buttress in Grotto Canyon"
    ],
    repairs: ["Retrofit of 6 routes at <a href='https://app.tabvar.org/topos/100' target='_blank' >Echo Canyon</a>"]
  },
  {
    name: "Dan Padeanu",
    result: 2,
    routes: ["<a href='https://app.tabvar.org/topos/180' target='_blank'>Birdwatcher's Crag</a> – 11 new routes, 5.7 to 5.12a"],
    repairs: []
  }
];

const OTHER_NOMINEES = [
  "Grant Parkin", "Steve Fedyna", "Marcus Norman", "Chris Perry", "Ross Suchy",
  "Andy Genereux", "Adam Matias", "Brendan Clark", "Mirko Arcais & Michele Hueber", "Ben Firth",
];

function WorkList({ title, items }: { title: string; items: string[] }) {
  return <div>
    <Text fw={700} size="sm" c="dimmed">{title}</Text>
    <ul>{items.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}</ul>
  </div>;
}

export default function ContestResults() {
  return (
    <main className="crowbar-page">
      <GoldenCrowbarHero
        year={2025}
        intro={GOLDCROW_DESC}
        before={<Anchor component={Link} to="/goldencrowbar" size="sm" className="crowbar-back">← Back to the 2026 ballot</Anchor>}
      />

      <Container size="lg" py={48}>
        <Stack gap="md">
          {WINNERS.map((winner) => {
            const won = winner.result === 1;
            return <Paper key={winner.name} withBorder radius="md" p="xl" className={`crowbar-winner${won ? "" : " is-runner-up"}`}>
              <Badge
                size="lg"
                color={won ? CROWBAR_GOLD : "gray.3"}
                autoContrast
                leftSection={won ? <IconTrophy size={14} /> : <IconMedal size={14} />}
              >
                {won ? "Winner" : "Runner-up"}
              </Badge>
              <Title order={2} mt="sm" mb="md">{winner.name}</Title>
              <Stack gap="md">
                <WorkList title="Routes established" items={winner.routes} />
                {winner.repairs.length > 0 && <WorkList title="Retrofits & maintenance" items={winner.repairs} />}
              </Stack>
            </Paper>;
          })}
        </Stack>

        <Title order={2} fz="xl" mt={48} mb="sm">2025 nominees</Title>
        <Group gap="xs">
          {[...WINNERS.map((winner) => winner.name), ...OTHER_NOMINEES].map((name) => <Badge key={name} variant="default" size="lg" tt="none" fw={600}>{name}</Badge>)}
        </Group>

        <Text c="dimmed" mt={48}>
          Thank you to everyone who participated and voted!
        </Text>
      </Container>
    </main>
  );
}
