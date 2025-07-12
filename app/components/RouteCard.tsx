import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme, Flex, Badge, Grid } from "@mantine/core";
import { IconFlag } from "@tabler/icons-react";
import { getGradeColor, getClimbStyleColorName } from "~/lib/constants";
import type { Route } from "~/lib/models";
import { TopoGallery } from "./TopoGallery";
import { useFetcher } from "@remix-run/react";
import { RichTextViewer } from "./RichTextViewer";
import { Link } from "@remix-run/react";

interface RouteCardProps {
    route: Route;
    theme: MantineTheme;
    canEdit?: boolean;
}

export function RouteCard({ route, theme, canEdit }: RouteCardProps) {
    const fetcher = useFetcher();

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        
        if (data.type === 'attachment') {
            const formData = new FormData();
            formData.append('_action', 'add');
            formData.append('routeId', route.id.toString());
            formData.append('attachmentId', data.id.toString());
            
            fetcher.submit(formData, { 
                method: 'post',
                action: '/api/attachments'
            });
        }
    };

    return (
        <Paper
            id={`route-${route.id}`}
            p="xs"
            withBorder
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
                borderLeft: `${rem(6)} solid ${getGradeColor(route.gradeYds ?? '')}`,
                flex: 1,
                minHeight: '62px',
                position: 'relative'
            }}
        >
            {canEdit && (route.year != null || route.sortOrder != null) && ( 
                <Text size="xs" c="dimmed" style={{ position: 'absolute', top: rem(4), right: rem(8) }}>
                    {route.year}
                    {route.year != null && route.sortOrder != null ? ' • ' : ''}
                    {route.sortOrder != null ? `#${route.sortOrder}` : ''}
                </Text>
            )}
            <Link 
                to={`/issues/create?routeId=${route.id}`}
                style={{ 
                    position: 'absolute',
                    bottom: rem(10),
                    right: rem(12),
                    fontSize: theme.fontSizes.xs,
                    color: theme.colors.gray[6],
                }}
            >
                Report Issue
            </Link>
            <Grid gutter="xs">
                {/* Row 1: Name, Grade, Topos */}
                <Grid.Col span="auto">
                    <Group gap="xs" wrap="nowrap">
                        <Text size="md" fw={500} truncate="end">
                            {route.name}
                        </Text>
                        {route.gradeYds && (
                        <Badge color={getGradeColor(route.gradeYds)} variant="light" size="lg">
                            {route.gradeYds}
                        </Badge>
                        )}
                        <TopoGallery
                            attachments={route.attachments ?? []}
                            routeId={route.id}
                            canEdit={canEdit}
                            size="xs"
                        />
                    </Group>
                </Grid.Col>
                
                {/* Row 2: Details - Simplified, removed nested grid */}
                <Grid.Col span={12}>
                    <Group gap="xs" wrap="nowrap">
                        {route.climbStyle && (
                            <Badge 
                                color={getClimbStyleColorName(route.climbStyle)}
                                variant="light"
                                size="sm"
                            >
                                {route.climbStyle}
                            </Badge>
                        )}
                        {(route.boltCount || (route.pitchCount && route.pitchCount > 1) || route.routeLength || route.firstAscentBy) && (
                             <Text size="sm" c="dimmed">
                                {route.climbStyle && (route.boltCount || (route.pitchCount && route.pitchCount > 1) || route.routeLength || route.firstAscentBy) ? `  •  ` : ''}
                                {route.boltCount ? `${route.boltCount} bolts` : ''}
                                {route.boltCount && (route.pitchCount && route.pitchCount > 1) ? `  •  ` : ''}{route.pitchCount && route.pitchCount > 1 ? `${route.pitchCount} pitches` : ''}
                                {((route.boltCount || (route.pitchCount && route.pitchCount > 1)) && route.routeLength) ? `  •  ` : ''}{route.routeLength ? `${route.routeLength}m (${Math.round(route.routeLength * 3.28084)}ft)` : ''}
                                {((route.boltCount || (route.pitchCount && route.pitchCount > 1) || route.routeLength) && route.firstAscentBy) ? `  •  ` : ''}{route.firstAscentBy ? `FA: ${route.firstAscentBy}` : ''}
                            </Text>
                        )}
                    </Group>
                </Grid.Col>

                {/* Row 3: Issues Display */}
                {route.issues.length > 0 && (
                    <Grid.Col span={12} mt="xs">
                        <Stack gap="xs">
                            <Group gap="xs" wrap="nowrap">
                                <IconFlag size={18} style={{ color: theme.colors.red[6], flexShrink: 0 }} />
                                <Badge 
                                    color="red" 
                                    variant="light"
                                    title={route.issues[0].description ?? undefined}
                                >
                                    {route.issues[0].issueType}{route.issues[0].subIssueType ? ` - ${route.issues[0].subIssueType}` : ''}
                                </Badge>
                            </Group>
                            {route.issues[0].flaggedMessage && (
                                <Text size="sm" c="red.7" fw={500}>
                                    ⚠️ Safety Notice: {route.issues[0].flaggedMessage}
                                </Text>
                            )}
                        </Stack>
                    </Grid.Col>
                )}
                
                {/* Row 4: Notes (Moved Here) */}
                {route.notes && (
                    <Grid.Col span={12} mt="xs">
                        <Box style={{ fontSize: theme.fontSizes.sm }}>
                            <RichTextViewer content={route.notes} />
                        </Box>
                    </Grid.Col>
                )}
            </Grid>
        </Paper>
    );
} 