import type { ReactNode } from "react";
import { Container, Group, Text, ThemeIcon, Title } from "@mantine/core";
import { IconTrophy } from "@tabler/icons-react";
import "~/styles/goldencrowbar.css";

/** Award accent for Mantine `color` props; keep in sync with `--crowbar-gold` in goldencrowbar.css. */
export const CROWBAR_GOLD = "#e2a72e";

interface GoldenCrowbarHeroProps {
  year: number;
  intro: ReactNode;
  /** Shown above the eyebrow, e.g. a link back to the current ballot. */
  before?: ReactNode;
  /** Shown beside the title on wide screens and below it on narrow ones. */
  aside?: ReactNode;
}

export function GoldenCrowbarHero({ year, intro, before, aside }: GoldenCrowbarHeroProps) {
  return <header className="crowbar-hero">
    <Container size="lg" className={aside ? "crowbar-hero-grid" : undefined}>
      <div>
        {before}
        <Group gap="xs" mb="sm">
          <ThemeIcon size={30} radius="xl" className="crowbar-medal" aria-hidden="true"><IconTrophy size={17} /></ThemeIcon>
          <Text fw={700} size="sm" className="crowbar-eyebrow">TABVAR community award</Text>
        </Group>
        <Title order={1} className="crowbar-title">Golden Crowbar <span>{year}</span></Title>
        <Text size="lg" mt="md" className="crowbar-intro">{intro}</Text>
      </div>
      {aside}
    </Container>
  </header>;
}
