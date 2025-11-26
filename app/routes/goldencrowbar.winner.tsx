import { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { getDB } from "~/lib/db";
import {
    Container,
    Title,
    Text,
    Stack,
    Group,
    Paper,
    Transition,
    Center,
    ThemeIcon,
    Box,
    Badge
} from "@mantine/core";
import { IconTrophy, IconMedal, IconTool } from "@tabler/icons-react";
import { useState, useEffect, useCallback } from "react";

export const meta: MetaFunction = () => {
    return [
        { title: "Golden Crowbar Award - Winner" },
    ];
};

interface Contestant {
    name: string;
    routes: string[];
    repairs: string[];
}

interface RankedContestant extends Contestant {
    id: number;
    voteCount: number;
    rank: number;
}

// Local copy of contestant data to keep file self-contained
const CONTESTANT_DATA: Contestant[] = [
    {
        name: "Grant Parkin",
        routes: [
            "Lower Door Jamb – 2 new 5.8 multipitch routes",
            "Bluerock Crag – 4 new routes, 5.4 to 5.8"
        ],
        repairs: ["Retrofit on Lost and Crossed on Rundle Ridge"]
    },
    {
        name: "Dan Padeanu",
        routes: ["Birdwatcher's Crag – 11 new routes, 5.7 to 5.12a"],
        repairs: []
    },
    {
        name: "Steve Fedyna",
        routes: ["ŞäÅĢÁ – 2 new routes, 5.8 to 5.10a"],
        repairs: ["Retrofits at Sunshine Slabs (1 route) and Kid Goat (1 route)"]
    },
    {
        name: "Marcus Norman",
        routes: [
            "Bataan – 1 new route, 5.13+",
            "Acephale – 2 new routes, 5.12c to 5.12+"
        ],
        repairs: ["Retrofit of 1 route at Acephale"]
    },
    {
        name: "Chris Perry",
        routes: ["Forever Yonge – 5.10d, 7 pitch bolted route on Tunnel Mountain"],
        repairs: []
    },
    {
        name: "Ross Suchy",
        routes: [
            "Moose Mountain - 9 new routes, 5.11b to 5.13a",
            "Black Feather Canyon – 1 new route, 5.11a",
            "Long Shadows – 2 pitch 5.12c route in the Ghost"
        ],
        repairs: []
    },
    {
        name: "Andy Genereux",
        routes: [
            "Thriller – 5.8, 10 pitch bolted route on Mount Indefatigable",
            "Moose Mountain - 13 new routes, 5.9 to 5.11c"
        ],
        repairs: []
    },
    {
        name: "Adam Matias",
        routes: ["West Phantom Bluffs – 5 new routes, 5.7 to 5.10a"],
        repairs: []
    },
    {
        name: "Brendan Clark",
        routes: ["Quaite Valley – 7 new multipitch routes & 2 new single pitch routes, 5.3 to 5.10a"],
        repairs: []
    },
    {
        name: "Mirko Arcais & Michele Hueber",
        routes: ["Memory Lane – 5.11b A0/5.11d, 10 pitch bolted route on the Canmore Wall"],
        repairs: []
    },
    {
        name: "Matt Laird & Andrew Slootweg",
        routes: [
            "Matt Laird & Andrew Slootweg: Bastion – 5.10c, 10 pitch bolted route on Lookout Tower, Castle Mountain",
            "Matt Laird: Creature from the Black Lagoon – 5.11a, 4 pitch bolted route on Mount McGillivray",
            "Matt Laird: Macaroon – 5.10d, 3 pitch route on Armadillo Buttress in Grotto Canyon"
        ],
        repairs: ["Retrofit of 6 routes at Echo Canyon"]
    },
    {
        name: "Ben Firth",
        routes: [
            "Blackfeather Canyon – 3 new routes, 5.12b to 5.12d",
            "Buffalo Crag – 7 new routes, 5.11a to 5.14"
        ],
        repairs: ["Retrofit of 4 routes at Blackfeather Canyon"]
    }
];

// Mock data for preview/testing without unlock code
const MOCK_CONTESTANT_DATA: Contestant[] = [
    {
        name: "Rocky Balboa",
        routes: ["Eye of the Tiger – 5.10a", "Steps of Philadelphia – 5.8"],
        repairs: []
    },
    {
        name: "Lara Croft",
        routes: ["Tomb Raider – 5.12b", "Artifact Hunter – 5.11c"],
        repairs: ["Retrofit of Croft Manor"]
    }
];

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const unlock = url.searchParams.get("unlock");
    const isUnlocked = unlock === "nightoflies";

    if (!isUnlocked) {
        return {
            winner: { ...MOCK_CONTESTANT_DATA[0], id: 999, voteCount: 100, rank: 1 },
            runnerUp: { ...MOCK_CONTESTANT_DATA[1], id: 998, voteCount: 50, rank: 2 },
            totalVotes: 150
        };
    }

    const db = getDB(context);

    // 1. Get Campaign
    const campaign = await db
        .selectFrom('campaign')
        .select('id')
        .where('name', '=', '2025 Golden Crowbar Award')
        .executeTakeFirst();

    if (!campaign) {
        throw new Response("Campaign not found", { status: 404 });
    }

    // 2. Get Candidates
    const candidates = await db
        .selectFrom('campaign_candidate')
        .selectAll()
        .where('campaign_id', '=', campaign.id)
        .execute();

    // 3. Get Votes Count
    const voteCounts = await db
        .selectFrom('vote')
        .select(['campaign_candidate_id', db.fn.count<number>('id').as('count')])
        .where('campaign_id', '=', campaign.id)
        .groupBy('campaign_candidate_id')
        .execute();

    // 4. Merge and Sort
    const rankedCandidates: RankedContestant[] = candidates.map(candidate => {
        const votes = voteCounts.find(v => v.campaign_candidate_id === candidate.id)?.count || 0;
        const details = CONTESTANT_DATA.find(c => c.name === candidate.name);

        return {
            id: candidate.id,
            name: candidate.name,
            routes: details?.routes || [],
            repairs: details?.repairs || [],
            voteCount: Number(votes),
            rank: 0 // Placeholder
        };
    })
        .sort((a, b) => b.voteCount - a.voteCount)
        .map((c, index) => ({ ...c, rank: index + 1 }));

    return {
        winner: rankedCandidates[0],
        runnerUp: rankedCandidates[1],
        totalVotes: rankedCandidates.reduce((sum, c) => sum + c.voteCount, 0)
    };
};

// Simple Confetti Component
const Confetti = () => {
    useEffect(() => {
        const colors = ['#FFD700', '#FFA500', '#FF4500', '#C0C0C0', '#ffffff'];
        const particleCount = 150;

        const createParticle = (x: number, y: number) => {
            const particle = document.createElement('div');
            const size = Math.random() * 10 + 5;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];
            particle.style.position = 'fixed';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.borderRadius = '50%';
            particle.style.pointerEvents = 'none';
            particle.style.zIndex = '9999';

            // Random direction
            const angle = Math.random() * Math.PI * 2;
            const velocity = Math.random() * 10 + 5;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;

            let posX = x;
            let posY = y;
            let opacity = 1;

            const animate = () => {
                posX += vx;
                posY += vy + 2; // Gravity
                opacity -= 0.01;

                particle.style.left = `${posX}px`;
                particle.style.top = `${posY}px`;
                particle.style.opacity = `${opacity}`;

                if (opacity > 0) {
                    requestAnimationFrame(animate);
                } else {
                    particle.remove();
                }
            };

            document.body.appendChild(particle);
            requestAnimationFrame(animate);
        };

        // Burst from center
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        for (let i = 0; i < particleCount; i++) {
            setTimeout(() => {
                createParticle(centerX, centerY);
            }, i * 5);
        }

        // Cleanup
        return () => {
            // Particles remove themselves
        };
    }, []);

    return null;
};

export default function WinnerPage() {
    const { winner, runnerUp } = useLoaderData<typeof loader>();
    const [step, setStep] = useState(0); // 0: Intro, 1: Runner Up, 2: Pre-Winner, 3: Winner

    const nextStep = useCallback(() => {
        setStep(s => Math.min(s + 1, 3));
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter') {
                nextStep();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [nextStep]);

    return (
        <Box
            style={{
                minHeight: '100vh',
                background: 'radial-gradient(circle at center, #1a1b1e 0%, #000000 100%)',
                color: 'white',
                overflow: 'hidden',
                position: 'relative'
            }}
            onClick={nextStep}
        >
            {step === 3 && <Confetti />}

            <Container size="xl" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

                {/* Header - Always visible but fades out slightly */}
                <Transition mounted={true} transition="fade" duration={1000}>
                    {(styles) => (
                        <Stack align="center" style={{ ...styles, marginBottom: 60, opacity: step === 3 ? 0.6 : 1 }}>
                            <Title
                                order={1}
                                style={{
                                    fontSize: '4rem',
                                    textTransform: 'uppercase',
                                    letterSpacing: '4px',
                                    background: 'linear-gradient(45deg, #FFD700, #FDB931)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    filter: 'drop-shadow(0 0 20px rgba(255, 215, 0, 0.3))'
                                }}
                            >
                                Golden Crowbar
                            </Title>
                            <Text size="xl" c="dimmed" style={{ letterSpacing: '2px' }}>2025 AWARD CEREMONY</Text>
                        </Stack>
                    )}
                </Transition>

                <Center style={{ flex: 1, position: 'relative' }}>

                    {/* STEP 0: INTRO */}
                    <Transition mounted={step === 0} transition="slide-up" duration={500} timingFunction="ease">
                        {(styles) => (
                            <Stack align="center" gap="xl" style={{ ...styles, position: 'absolute' }}>
                                <ThemeIcon size={200} radius="100%" variant="gradient" gradient={{ from: 'yellow', to: 'orange' }}>
                                    <IconTool size={120} />
                                </ThemeIcon>
                                <Title order={2} size="h1">Ready to reveal the winner?</Title>
                                <Text c="dimmed" size="lg">Press Space or Click to continue</Text>
                            </Stack>
                        )}
                    </Transition>

                    {/* STEP 1: RUNNER UP */}
                    <Transition mounted={step === 1} transition="slide-left" duration={800} timingFunction="ease-out">
                        {(styles) => (
                            <Paper
                                shadow="xl"
                                p={60}
                                radius="lg"
                                style={{
                                    ...styles,
                                    position: 'absolute',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    backdropFilter: 'blur(10px)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    width: '80%',
                                    maxWidth: 900
                                }}
                            >
                                <Group align="flex-start" wrap="nowrap">
                                    <ThemeIcon size={120} radius="md" color="gray" variant="light">
                                        <IconMedal size={80} />
                                    </ThemeIcon>
                                    <Stack gap="md" style={{ flex: 1 }}>
                                        <Badge size="xl" color="gray" variant="filled">RUNNER UP</Badge>
                                        <Title order={2} style={{ fontSize: '3.5rem', lineHeight: 1.1 }}>
                                            {runnerUp.name}
                                        </Title>
                                        <Stack gap="xs" mt="md">
                                            {runnerUp.routes.slice(0, 3).map((route, i) => (
                                                <Text key={i} size="lg" c="dimmed">
                                                    <span dangerouslySetInnerHTML={{ __html: `• ${route}` }} />
                                                </Text>
                                            ))}
                                        </Stack>
                                    </Stack>
                                </Group>
                            </Paper>
                        )}
                    </Transition>

                    {/* STEP 2: PRE-WINNER TENSION */}
                    <Transition mounted={step === 2} transition="fade" duration={1000}>
                        {(styles) => (
                            <Stack align="center" style={{ ...styles, position: 'absolute' }}>
                                <Text
                                    style={{
                                        fontSize: '5rem',
                                        fontWeight: 900,
                                        animation: 'pulse 1s infinite'
                                    }}
                                >
                                    AND THE WINNER IS...
                                </Text>
                            </Stack>
                        )}
                    </Transition>

                    {/* STEP 3: WINNER */}
                    <Transition mounted={step === 3} transition="pop" duration={800} timingFunction="cubic-bezier(0.175, 0.885, 0.32, 1.275)">
                        {(styles) => (
                            <Paper
                                shadow="xl"
                                p={80}
                                radius="xl"
                                style={{
                                    ...styles,
                                    position: 'absolute',
                                    background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.1) 0%, rgba(0, 0, 0, 0.4) 100%)',
                                    backdropFilter: 'blur(20px)',
                                    border: '2px solid rgba(255, 215, 0, 0.3)',
                                    boxShadow: '0 0 100px rgba(255, 215, 0, 0.1)',
                                    width: '90%',
                                    maxWidth: 1100
                                }}
                            >
                                <Group align="center" justify="center" mb={40}>
                                    <IconTrophy size={80} color="#FFD700" style={{ filter: 'drop-shadow(0 0 10px gold)' }} />
                                    <Title
                                        order={1}
                                        style={{
                                            fontSize: '5rem',
                                            lineHeight: 1,
                                            color: '#FFD700',
                                            textShadow: '0 0 20px rgba(255, 215, 0, 0.5)'
                                        }}
                                    >
                                        {winner.name}
                                    </Title>
                                    <IconTrophy size={80} color="#FFD700" style={{ filter: 'drop-shadow(0 0 10px gold)' }} />
                                </Group>

                                <Group align="flex-start" gap={50}>
                                    <Stack style={{ flex: 1 }}>
                                        <Title order={3} c="yellow.1" mb="sm">New Routes</Title>
                                        {winner.routes.map((route, i) => (
                                            <Text key={i} size="xl" style={{ color: 'rgba(255,255,255,0.9)' }}>
                                                <span dangerouslySetInnerHTML={{ __html: `• ${route}` }} />
                                            </Text>
                                        ))}
                                    </Stack>

                                    {winner.repairs.length > 0 && (
                                        <Stack style={{ flex: 1 }}>
                                            <Title order={3} c="yellow.1" mb="sm">Retrofits & Repairs</Title>
                                            {winner.repairs.map((repair, i) => (
                                                <Text key={i} size="xl" style={{ color: 'rgba(255,255,255,0.9)' }}>
                                                    <span dangerouslySetInnerHTML={{ __html: `• ${repair}` }} />
                                                </Text>
                                            ))}
                                        </Stack>
                                    )}
                                </Group>
                            </Paper>
                        )}
                    </Transition>

                </Center>

                <Text ta="center" c="dimmed" size="sm" style={{ opacity: 0.3 }}>
                    Step {step + 1} / 4
                </Text>
            </Container>

            <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 0.8; }
        }
      `}</style>
        </Box>
    );
}
