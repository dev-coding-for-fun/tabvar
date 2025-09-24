import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { 
  Title, 
  Container, 
  Paper, 
  Text, 
  Stack, 
  Card, 
  Button, 
  Group, 
  Badge,
  Image,
  Divider,
  Center,
  ActionIcon,
  Flex
} from "@mantine/core";
import { Form, useLoaderData, useActionData, Link } from "@remix-run/react";
import { IconCheck } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { getAuthenticator, requireUser } from "~/lib/auth.server";
import { User } from "~/lib/models";
import { getDB } from "~/lib/db";
import { data } from "@remix-run/cloudflare";

interface CandidateCardProps {
  contestant: ContestantWithId;
  isSelected?: boolean;
  isClickable?: boolean;
  isVoted?: boolean;
  onClick?: () => void;
}

function CandidateCard({ contestant, isSelected = false, isClickable = true, isVoted = false, onClick }: CandidateCardProps) {
  const cardStyle = {
    cursor: isClickable ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
    backgroundColor: isSelected ? '#f8f9fa' : isVoted ? '#e7f5ff' : 'white',
    borderColor: isSelected || isVoted ? '#339af0' : '#e9ecef',
    borderWidth: isSelected || isVoted ? '2px' : '1px',
    opacity: !isClickable && !isVoted ? 0.7 : 1,
  };

  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
      style={cardStyle}
      onClick={isClickable ? onClick : undefined}
    >
      <Group justify="space-between" mb="sm">
        <Title order={3}>{contestant.name}</Title>
        {(isSelected || isVoted) && (
          <ActionIcon variant="filled" color="blue" size="sm">
            <IconCheck size={16} />
          </ActionIcon>
        )}
      </Group>
      
      <Flex gap="md" mb="md" direction={{ base: 'column', sm: 'row' }}>
        <div style={{ flex: contestant.repairs.length > 0 ? '3' : '1' }}>
          <Text size="sm" fw={500} mb="xs">
            Routes Established
          </Text>
          <Stack gap={4}>
            {contestant.routes.map((route, idx) => (
              <Text key={idx} size="xs" c="dark">
                <span dangerouslySetInnerHTML={{ __html: `• ${route}` }} />
              </Text>
            ))}
          </Stack>
        </div>
        
        {contestant.repairs.length > 0 && (
          <div style={{ flex: '2' }}>
            <Text size="sm" fw={500} mb="xs">
              Retrofits & Maintenance
            </Text>
            <Stack gap={4}>
              {contestant.repairs.map((repair, idx) => (
                <Text key={idx} size="xs" c="dark">
                  <span dangerouslySetInnerHTML={{ __html: `• ${repair}` }} />
                </Text>
              ))}
            </Stack>
          </div>
        )}
      </Flex>
    </Card>
  );
}

export const meta: MetaFunction = () => {
  return [
    { title: "Golden Crowbar Award - Tabvar" },
    {
      name: "description",
      content: "Vote for the Golden Crowbar award - recognizing outstanding route builders",
    },
  ];
};

interface LoaderData {
  user: User | null;
  contestants: ContestantWithId[];
  userVote: ContestantWithId | null;
}

interface ActionData {
  success?: boolean;
  error?: string;
  message?: string;
}

interface ContestantWithId {
  id?: number; // This will be the campaign_candidate_id from database
  name: string;
  routes: string[];
  repairs: string[];
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const user = await getAuthenticator(context).isAuthenticated(request);
  const db = getDB(context);
  
  // Get the Golden Crowbar campaign
  const campaign = await db
    .selectFrom('campaign')
    .selectAll()
    .where('name', '=', '2025 Golden Crowbar Award')
    .executeTakeFirst();
    
  if (!campaign) {
    throw new Response("Campaign not found", { status: 404 });
  }
  
  // Get all candidates for this campaign
  const candidates = await db
    .selectFrom('campaign_candidate')
    .selectAll()
    .where('campaign_id', '=', campaign.id)
    .execute();
    
  // Create contestant data with database IDs
  const contestantData = getContestantData();
  const contestants = contestantData.map(contestant => {
    const candidate = candidates.find(c => c.name === contestant.name);
    if (!candidate) {
      throw new Error(`Candidate not found in database: ${contestant.name}`);
    }
    return {
      ...contestant,
      id: candidate.id
    };
  });
  
  // Check if user has already voted in this campaign
  let userVote: ContestantWithId | null = null;
  if (user) {
    const existingVote = await db
      .selectFrom('vote')
      .innerJoin('campaign_candidate', 'vote.campaign_candidate_id', 'campaign_candidate.id')
      .selectAll()
      .where('vote.uid', '=', user.uid)
      .where('vote.campaign_id', '=', campaign.id)
      .executeTakeFirst();
      
    if (existingVote) {
      // Find the contestant they voted for
      userVote = contestants.find(c => c.id === existingVote.campaign_candidate_id) || null;
    }
  }
  
  return { user, contestants, userVote };
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const user = await requireUser(request, context);
  const formData = await request.formData();
  const candidateId = Number(formData.get("campaign_candidate_id"));
  
  if (!candidateId) {
    return data({ success: false, error: "No candidate selected" }, { status: 400 });
  }
  
  const db = getDB(context);
  
  // Get the candidate and campaign info
  const candidate = await db
    .selectFrom('campaign_candidate')
    .selectAll()
    .where('id', '=', candidateId)
    .executeTakeFirst();
    
  if (!candidate) {
    return data({ success: false, error: "Invalid candidate" }, { status: 400 });
  }
  
  // Check if user has already voted in this campaign
  const existingVote = await db
    .selectFrom('vote')
    .selectAll()
    .where('uid', '=', user.uid)
    .where('campaign_id', '=', candidate.campaign_id)
    .executeTakeFirst();
    
  if (existingVote) {
    return data({ success: false, error: "You have already voted in this campaign" }, { status: 400 });
  }
  
  // Record the vote
  try {
    await db
      .insertInto('vote')
      .values({
        uid: user.uid,
        campaign_id: candidate.campaign_id,
        campaign_candidate_id: candidateId
      })
      .execute();
      
    return data({ success: true, message: `Vote successfully cast for ${candidate.name}!` });
  } catch (error) {
    console.error('Error recording vote:', error);
    return data({ success: false, error: "Failed to record vote" }, { status: 500 });
  }
};

// Golden Crowbar Award contestants data
function getContestantData(): ContestantWithId[] {
  return [
  {
    name: "Grant Parkin",
    routes: [
      "Lower <a href='https://app.tabvar.org/topos/154' target='_blank' >Door Jamb</a> – 2 new 5.8 multipitch routes",
      "Bluerock Crag – 4 new routes, 5.4 to 5.8"
    ],
    repairs: ["Retrofit on <a href='https://app.tabvar.org/topos/132#route-3664' target='_blank'>Lost and Crossed on Rundle Ridge</a>"]
  },
  {
    name: "Dan Padeanu",
    routes: ["<a href='https://app.tabvar.org/topos/180' target='_blank'>Birdwatcher's Crag</a> – 11 new routes, 5.7 to 5.12a"],
    repairs: []
  },
  {
    name: "Steve Fedyna",
    routes: ["<a href='https://app.tabvar.org/topos/183' target='_blank'>ŞäÅĢÁ</a> – 2 new routes, 5.8 to 5.10a"],
    repairs: ["Retrofits at Sunshine Slabs (1 route) and <a href='https://app.tabvar.org/topos/119' target='_blank'>Kid Goat</a> (1 route)"]
  },
  {
    name: "Marcus Norman",
    routes: [
      "<a href='https://app.tabvar.org/topos/99' target='_blank' >Bataan</a> – 1 new route, 5.13+",
      "<a href='https://app.tabvar.org/topos/97' target='_blank' >Acephale</a> – 2 new routes, 5.12c to 5.12+"
    ],
    repairs: ["Retrofit of 1 route at <a href='https://app.tabvar.org/topos/97' target='_blank' >Acephale</a>"]
  },
  {
    name: "Chris Perry",
    routes: ["<a href='https://app.tabvar.org/topos/115#route-3681' target='_blank'>Forever Yonge – 5.10d</a>, 7 pitch bolted route on Tunnel Mountain"],
    repairs: []
  },
  {
    name: "Ross Suchy",
    routes: [
      "<a href='https://app.tabvar.org/topos/106' target='_blank' >Moose Mountain</a> - 9 new routes, 5.11b to 5.13a",
      "<a href='https://app.tabvar.org/topos/128' target='_blank' >Black Feather Canyon</a> – 1 new route, 5.11a",
      "<a href='https://app.tabvar.org/topos/176#route-3695' target='_blank'>Long Shadows</a> – 2 pitch 5.12c route in the Ghost"
    ],
    repairs: []
  },
  {
    name: "Andy Genereux",
    routes: [
      "<a href='https://app.tabvar.org/topos/164#route-3663' target='_blank'>Thriller – 5.8</a>, 10 pitch bolted route on Mount Indefatigable",
      "<a href='https://app.tabvar.org/topos/106' target='_blank' >Moose Mountain</a> - 13 new routes, 5.9 to 5.11c"
    ],
    repairs: []
  },
  {
    name: "Adam Matias",
    routes: ["<a href='https://app.tabvar.org/topos/176#sector-1146' target='_blank'>West Phantom Bluffs</a> – 5 new routes, 5.7 to 5.10a"],
    repairs: []
  },
  {
    name: "Brendan Clark",
    routes: ["<a href='https://app.tabvar.org/topos/111' target='_blank' >Quaite Valley</a> – 7 new multipitch routes & 2 new single pitch routes, 5.3 to 5.10a"],
    repairs: []
  },
  {
    name: "Mirko Arcais & Michele Hueber",
    routes: ["<a href='https://app.tabvar.org/topos/173#route-3690' target='_blank'>Memory Lane – 5.11b A0/5.11d</a>, 10 pitch bolted route on the Canmore Wall"],
    repairs: []
  },
  {
    name: "Matt Laird & Andrew Slootweg",
    routes: [
      "Matt Laird & Andrew Slootweg: <a href='https://app.tabvar.org/topos/127#route-3685' target='_blank' >Bastion – 5.10c</a>, 10 pitch bolted route on Lookout Tower, Castle Mountain",
      "Matt Laird: <a href='https://app.tabvar.org/topos/199#route-3670' target='_blank'>Creature from the Black Lagoon – 5.11a</a>, 4 pitch bolted route on Mount McGillivray",
      "Matt Laird: <a href='https://app.tabvar.org/topos/98#route-3780' target='_blank'>Macaroon – 5.10d</a>, 3 pitch route on Armadillo Buttress in Grotto Canyon"
    ],
    repairs: ["Retrofit of 6 routes at <a href='https://app.tabvar.org/topos/100' target='_blank' >Echo Canyon</a>"]
  },
  {
    name: "Ben Firth",
    routes: [
      "<a href='https://app.tabvar.org/topos/128' target='_blank' >Blackfeather Canyon</a> – 3 new routes, 5.12b to 5.12d",
      "<a href='https://app.tabvar.org/topos/162' target='_blank' >Buffalo Crag</a> – 7 new routes, 5.11a to 5.14"
    ],
    repairs: ["Retrofit of 4 routes at <a href='https://app.tabvar.org/topos/128' target='_blank' >Blackfeather Canyon</a>"]
  }
  ];
}

export default function Contest() {
  const { user, contestants, userVote } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const [selectedContestant, setSelectedContestant] = useState<number | null>(null);
  
  // Reset selection and show success message after successful vote
  useEffect(() => {
    if (actionData?.success) {
      setSelectedContestant(null);
    }
  }, [actionData]);

  // Split contestants based on whether user voted for them
  const remainingContestants = userVote 
    ? contestants.filter(c => c.id !== userVote.id)
    : contestants;

  return (
    <Container size="lg" my={40}>
      <Title ta="center" fw={900} mb={30}>
        Golden Crowbar Award
      </Title>
      
      <Paper withBorder shadow="sm" p={40} radius="md" mb={40}>
        <Stack gap="lg">
          <div>
            <Title order={2} size="h3" mb="md">
              🛠️ Introducing The Golden Crowbar — TABVAR's New Annual Recognition Program!
            </Title>
            <Text size="md" lh={1.6}>
              Starting this year, TABVAR is proud to launch The Golden Crowbar, a community-driven initiative to celebrate outstanding route development in the Bow Valley. Whether it's a bold new crag, a single-pitch gem, or a lovingly retrofitted classic, this is your chance to recognize the developers who keep our climbing scene thriving.
            </Text>
          </div>

          <div>
            <Title order={3} size="h4" mb="sm">
              🗳️ How It Works
            </Title>
            <Stack gap="xs">
              <Text size="sm"><strong>Voting Ends: November 28, 2025</strong></Text>
              <Text size="sm"><strong>Winner Announced:</strong> At this year's Night of Lies on November 28</Text>
            </Stack>
          </div>

          <div>
            <Title order={3} size="h4" mb="sm">
              🏆 What's at Stake?
            </Title>
            <Text size="sm" mb="xs">The winner of The Golden Crowbar will receive:</Text>
            <Stack gap="xs" ml="md">
              <Text size="sm">• Gear prizes from OnWardUp, Vertical Addiction, Arc'teryx and Black Diamond</Text>
              <Text size="sm">• Their name engraved on the Golden Crowbar Trophy for the year</Text>
            </Stack>
          </div>

          <div>
            <Title order={3} size="h4" mb="sm">
              🗺️ Need a refresher on what was developed?
            </Title>
            <Text size="sm">
              Check out the <a href="https://www.google.com/maps/d/viewer?mid=1lOH3K-OSpv1eYsiTIZgCo3Aa6BUT_8k&ll=50.968226668615614%2C-115.35179625000002&z=9" target="_blank">2024 Development Map</a> to explore all the new and retrofitted routes.
            </Text>
          </div>

          <div>
            <Title order={3} size="h4" mb="sm">
              📣 Did we miss your project?
            </Title>
            <Text size="sm">
              If you contributed to route development in 2024—funded or not—please get in touch so we can include your work in the voting list.
            </Text>
          </div>

          <Text size="md" ta="center" fw={500} style={{ fontStyle: 'italic' }}>
            Let's celebrate the visionaries who swing the crowbar and shape the future of Bow Valley climbing. Spread the word, cast your vote, and join us for the big reveal at Night of Lies!
          </Text>
          
          <div>
            <Title order={3} size="h4" mb="md" ta="center">
              🙏 Thank You to Our Prize Sponsors
            </Title>
            <Group justify="center" gap="xl">
              <Image
                src="/onwardup.png"
                alt="OnWardUp Canmore"
                h={20}
                w="auto"
                fit="contain"
                style={{ filter: 'invert(1)' }}
              />
              <Image
                src="/arcteryxalberta.png"
                alt="Arc'teryx Alberta"
                h={136}
                w="auto"
                fit="contain"
              />
              <Image
                src="/verticaladdiction.webp"
                alt="Vertical Addiction Canmore"
                h={45}
                w="auto"
                fit="contain"
              />
              <Image
                src="/blackdiamond.png"
                alt="Black Diamond"
                h={38}
                w="auto"
                fit="contain"
              />

            </Group>
          </div>
        </Stack>
      </Paper>
      
      {actionData?.success && (
        <Paper withBorder shadow="md" p={20} radius="md" mb={20} style={{ backgroundColor: '#d3f9d8', borderColor: '#51cf66' }}>
          <Text ta="center" c="green" fw={500}>
            {actionData.message}
          </Text>
        </Paper>
      )}
      
      {actionData?.error && (
        <Paper withBorder shadow="md" p={20} radius="md" mb={20} style={{ backgroundColor: '#ffe0e0', borderColor: '#fa5252' }}>
          <Text ta="center" c="red" fw={500}>
            {actionData.error}
          </Text>
        </Paper>
      )}
      
      {userVote && (
        <Paper withBorder shadow="md" p={30} radius="md" mb={30} style={{ backgroundColor: '#f8f9fa' }}>
          <Text size="sm" fw={500} mb={20}>
            Your vote for the Golden Crowbar Award:
          </Text>
          
          <CandidateCard
            contestant={userVote}
            isVoted={true}
            isClickable={false}
          />
          
          <Text size="xs" c="dimmed" ta="center" mt={15}>
            Thank you for voting! You can only vote once per campaign.
          </Text>
        </Paper>
      )}

      <Paper withBorder shadow="md" p={30} radius="md" mb={30}>
        <Text size="sm" c="dimmed" mb={20}>
          {userVote 
            ? "Other nominees for the 2024 Golden Crowbar Award:" 
            : "Select your choice for this year's Golden Crowbar Award winner:"
          }
        </Text>
        
        <Stack gap="md">
          {remainingContestants.map((contestant) => (
            <CandidateCard
              key={contestant.id}
              contestant={contestant}
              isSelected={selectedContestant === contestant.id}
              isClickable={!userVote}
              onClick={() => setSelectedContestant(contestant.id ?? null)}
            />
          ))}
        </Stack>
        
        <Divider my="xl" />
        
        <Center>
          {!userVote && user ? (
            <Form method="post">
              <input type="hidden" name="campaign_candidate_id" value={selectedContestant || ''} />
              <Button 
                type="submit" 
                size="lg" 
                disabled={!selectedContestant}
                variant="filled"
              >
                Submit Vote
              </Button>
            </Form>
          ) : !userVote && !user ? (
            <Stack align="center" gap="md">
              <Text size="sm" c="dimmed" ta="center">
                Please sign in to cast your vote
              </Text>
              <Button
                component={Link}
                to="/login?redirectTo=%2Fgoldencrowbar"
                leftSection={<Image src="/google.png" alt="Google logo" width={20} height={20} />}
                variant="default"
                color="gray"
                size="lg"
              >
                Sign in with Google
              </Button>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" ta="center">
              Thanks for voting in the Golden Crowbar Award!
            </Text>
          )}
        </Center>
      </Paper>
    </Container>
  );
} 