import { Container, Group, Paper, Stack, Text, Title, useMantineTheme, rem, Button, Box, Badge, ActionIcon } from "@mantine/core";
import { json, type LoaderFunction } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { sql } from "kysely";
import { IconFlag, IconArrowBack } from "@tabler/icons-react";
import { getDB } from "~/lib/db";
import { useEffect, useRef, useState } from "react";
import { getGradeColor } from "~/lib/constants";
import type { Crag, Sector, Route } from "~/lib/models";

interface CragData {
  name: string;
  sectors: Array<Sector & { routes: Array<Route & {
    has_issue: boolean;
    issue_type?: string;
    sub_issue_type?: string;
    issue_description?: string;
    flagged_message?: string;
  }> }>;
  stats_public_issue_count: number;
}

export const loader: LoaderFunction = async ({ params, context }) => {
  const db = getDB(context);
  const cragName = params.crag;

  if (!cragName) {
    throw new Response("Crag name is required", { status: 400 });
  }

  // Get crag data with all its sectors and routes
  const cragData = await db
    .selectFrom("crag")
    .where("crag.name", "=", cragName)
    .select(["crag.id", "crag.name", "crag.stats_public_issue_count"])
    .executeTakeFirst();

  if (!cragData) {
    throw new Response("Crag not found", { status: 404 });
  }

  // Get all sectors and their routes for this crag, including issue information
  const sectorsWithRoutes = await db
    .selectFrom("sector")
    .where("sector.crag_id", "=", cragData.id)
    .leftJoin("route", "route.sector_id", "sector.id")
    .leftJoin(
      db.selectFrom("issue")
        .select([
          "id",
          "route_id",
          "issue_type",
          "sub_issue_type",
          "description",
          "is_flagged",
          "flagged_message",
          db.fn.count("id").as("issue_count")
        ])
        .where("status", "not in", ["Archived", "Closed", "Completed", "In Moderation"])
        .groupBy(["route_id", "issue_type", "sub_issue_type", "description", "is_flagged", "flagged_message"])
        .as("active_issues"),
      "active_issues.route_id",
      "route.id"
    )
    .select([
      "sector.id as sector_id",
      "sector.name as sector_name",
      "route.id as route_id",
      "route.name as route_name",
      "route.grade_yds",
      "route.climb_style",
      "route.bolt_count",
      "route.first_ascent_by",
      "route.route_length",
      sql<number>`COALESCE(active_issues.issue_count, 0)`.as("has_active_issue"),
      "active_issues.issue_type",
      "active_issues.sub_issue_type",
      "active_issues.description as issue_description",
      "active_issues.flagged_message"
    ])
    .orderBy("sector.name")
    .orderBy("route.sort_order")
    .execute();

  // Transform the flat data into a nested structure
  const sectors: Array<Sector & { routes: Array<Route & {
    has_issue: boolean;
    issue_type?: string;
    sub_issue_type?: string;
    issue_description?: string;
    flagged_message?: string;
  }> }> = [];
  const sectorMap = new Map<number, Sector & { routes: Array<Route & {
    has_issue: boolean;
    issue_type?: string;
    sub_issue_type?: string;
    issue_description?: string;
    flagged_message?: string;
  }> }>();

  sectorsWithRoutes.forEach((row) => {
    if (!sectorMap.has(row.sector_id)) {
      const newSector: Sector & { routes: Array<Route & {
        has_issue: boolean;
        issue_type?: string;
        sub_issue_type?: string;
        issue_description?: string;
        flagged_message?: string;
      }> } = {
        id: row.sector_id,
        name: row.sector_name,
        routes: [],
      };
      sectors.push(newSector);
      sectorMap.set(row.sector_id, newSector);
    }

    if (row.route_id && row.route_name) {
      const sector = sectorMap.get(row.sector_id);
      sector?.routes.push({
        id: row.route_id,
        name: row.route_name,
        gradeYds: row.grade_yds ?? undefined,
        climbStyle: row.climb_style ?? undefined,
        boltCount: row.bolt_count ?? undefined,
        firstAscentBy: row.first_ascent_by ?? undefined,
        routeLength: row.route_length ?? undefined,
        has_issue: row.has_active_issue > 0,
        issue_type: row.issue_type ?? undefined,
        sub_issue_type: row.sub_issue_type ?? undefined,
        issue_description: row.issue_description ?? undefined,
        flagged_message: row.flagged_message ?? undefined
      });
    }
  });

  return json({ 
    name: cragData.name, 
    sectors,
    stats_public_issue_count: cragData.stats_public_issue_count ?? 0 
  });
};

const TruncatableDescription: React.FC<{ description: string, fz: string }> = ({ description, fz }) => {
    const [expanded, setExpanded] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!textRef.current) return;

        const checkTruncation = () => {
            const element = textRef.current;
            if (element) {
                setIsTruncated(
                    element.scrollHeight > element.clientHeight ||
                    element.scrollWidth > element.clientWidth
                );
            }
        };

        const resizeObserver = new ResizeObserver(checkTruncation);
        resizeObserver.observe(textRef.current);

        return () => resizeObserver.disconnect();
    }, []);

    const toggleExpanded = () => setExpanded(!expanded);

    return (
        <Box>
            <Text
                fz={fz}
                ref={textRef}
                lineClamp={expanded ? undefined : 3}
                mb={4}
            >
                {description}
            </Text>
            {isTruncated && (
                <Button size="compact-xs" variant="subtle" onClick={toggleExpanded}>
                    {expanded ? 'Show less' : 'Show more'}
                </Button>
            )}
        </Box>
    );
};

export default function CragPage() {
  const cragData = useLoaderData<CragData>();
  const theme = useMantineTheme();

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" gap="xs" mb="xl">
          <Group gap="xs">
            <ActionIcon 
              component={Link} 
              to="/topos" 
              variant="subtle" 
              size="lg"
              color="gray"
              title="Back to Crags"
            >
              <IconArrowBack size={20} />
            </ActionIcon>
            <Title order={1}>
              {cragData.name}
            </Title>
            {cragData.stats_public_issue_count > 0 && (
              <Badge circle color="red" size="lg" variant="filled">
                {cragData.stats_public_issue_count}
              </Badge>
            )}
          </Group>
        </Group>

        {cragData.sectors.map((sector) => (
          <Paper
            key={sector.id}
            shadow="sm"
            p="md"
            withBorder
            style={{
              backgroundColor: theme.colors.gray[1]
            }}
          >
            <Title order={2} size="h4" mb="md">
              {sector.name}
            </Title>

            <Stack gap="xs">
              {sector.routes.map((route) => (
                <Paper
                  key={route.id}
                  p="xs"
                  withBorder
                  style={{
                    borderLeft: `${rem(6)} solid ${getGradeColor(route.gradeYds ?? '')}`,
                  }}
                >
                  <Stack gap={2}>
                    <Group justify="space-between">
                      <Group gap="xs">
                        {route.has_issue && (
                          <IconFlag size={18} style={{ color: theme.colors.red[6] }} />
                        )}
                        <Text size="md" fw={500}>
                          {route.name}
                        </Text>
                      </Group>
                      <Text size="md" c="dimmed">
                        {route.gradeYds}
                      </Text>
                    </Group>
                    
                    {route.has_issue && (
                      <Stack gap="xs">
                        <Text size="sm" c="red" fw={500}>
                          Issue: {route.issue_type}{route.sub_issue_type ? ` - ${route.sub_issue_type}` : ''}
                        </Text>
                        {route.issue_description && (
                          <TruncatableDescription description={route.issue_description} fz="sm" />
                        )}
                        {route.flagged_message && (
                          <Text size="sm" c="red.7" fw={500}>
                            ⚠️ Safety Notice: {route.flagged_message}
                          </Text>
                        )}
                      </Stack>
                    )}
                    
                    <Text size="xs" c="dimmed">
                      {route.climbStyle}
                      {route.boltCount ? ` • ${route.boltCount} bolts` : ''}
                      {route.routeLength ? ` • ${route.routeLength}m` : ''}
                    </Text>
                    
                    {route.firstAscentBy && (
                      <Text size="xs" c="dimmed" fs="italic">
                        First Ascent: {route.firstAscentBy}
                      </Text>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Container>
  );
}
