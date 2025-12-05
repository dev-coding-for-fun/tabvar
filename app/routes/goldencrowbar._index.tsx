import { Container, Title, Paper, Text, Stack, Badge, ThemeIcon, Flex } from "@mantine/core";
import { IconTrophy, IconMedal } from "@tabler/icons-react";
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
  return [
    { title: "Golden Crowbar Award 2025 - Winners" },
    {
      name: "description",
      content: "Announcing the winners of the 2025 Golden Crowbar Award",
    },
  ];
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

export default function ContestResults() {
  return (
    <Container size="lg" my={40}>
      <Title ta="center" fw={900} mb={50} size="h1">
        Golden Crowbar Award 2025
      </Title>

      <Stack gap={40}>
        {WINNERS.map((winner) => (
          <Paper
            key={winner.name}
            withBorder
            shadow="md"
            p={40}
            radius="md"
            style={{
              borderColor: winner.result === 1 ? '#FFD700' : '#C0C0C0',
              borderWidth: 2
            }}
          >
            <Flex direction={{ base: 'column', md: 'row' }} gap="xl" align="flex-start">
              <Stack align="center" style={{ minWidth: 200 }}>
                <ThemeIcon
                  size={120}
                  radius="100%"
                  variant="light"
                  color={winner.result === 1 ? 'yellow' : 'gray'}
                >
                  {winner.result === 1 ? <IconTrophy size={80} /> : <IconMedal size={80} />}
                </ThemeIcon>
                <Badge
                  size="xl"
                  color={winner.result === 1 ? 'yellow' : 'gray'}
                  variant="filled"
                >
                  {winner.result === 1 ? 'WINNER' : 'RUNNER UP'}
                </Badge>
              </Stack>

              <Stack style={{ flex: 1 }} gap="md">
                <Title order={2}>{winner.name}</Title>

                <div>
                  <Text fw={700} mb="xs" size="lg">Routes Established</Text>
                  <Stack gap="xs">
                    {winner.routes.map((route, idx) => (
                      <Text key={idx} dangerouslySetInnerHTML={{ __html: `• ${route}` }} />
                    ))}
                  </Stack>
                </div>

                {winner.repairs.length > 0 && (
                  <div>
                    <Text fw={700} mb="xs" size="lg">Retrofits & Maintenance</Text>
                    <Stack gap="xs">
                      {winner.repairs.map((repair, idx) => (
                        <Text key={idx} dangerouslySetInnerHTML={{ __html: `• ${repair}` }} />
                      ))}
                    </Stack>
                  </div>
                )}
              </Stack>
            </Flex>
          </Paper>
        ))}
      </Stack>

      <Text ta="center" c="dimmed" mt={50}>
        Thank you to everyone who participated and voted!
      </Text>
    </Container>
  );
}