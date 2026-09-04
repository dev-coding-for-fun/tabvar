import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme, Flex, Badge, Grid } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFlag, IconLink } from "@tabler/icons-react";
import { getGradeColor, getClimbStyleColorName } from "~/lib/constants";
import type { Route } from "~/lib/models";
import { TopoGallery } from "./TopoGallery";
import { useFetcher } from "react-router";
import { RichTextViewer } from "./RichTextViewer";
import { Link } from "react-router";
import { RouteIssuesModal } from "./RouteIssuesModal";

interface RouteCardProps {
    route: Route;
    theme: MantineTheme;
    canEdit?: boolean;
}

export function RouteCard({ route, theme, canEdit }: RouteCardProps) {
    const fetcher = useFetcher();
    const [isIssuesModalOpen, { open: openIssuesModal, close: closeIssuesModal }] = useDisclosure(false);

    // The loader hides closed and unmoderated issues, and sorts flagged ones first.
    const issues = route.issues ?? [];
    const primaryIssue = issues[0];
    const hasFlagged = issues.some((i) => i.isFlagged);

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
                    fontSize: theme?.fontSizes?.xs ?? 'var(--mantine-font-size-xs)',
                    color: theme?.colors?.gray?.[6] ?? 'var(--mantine-color-gray-6)',
                }}
            >
                Report Issue
            </Link>
            <Grid gap="xs">
                {/* Row 1: Name, Grade, Topos, Issues Indicator */}
                <Grid.Col span="auto">
                    <Group gap="xs" wrap="nowrap">
                        <Text size="md" fw={500} truncate="end">
                            {route.name}
                        </Text>
                        <IconLink
                            size={16}
                            style={{ 
                                cursor: 'pointer',
                                color: theme.colors.gray[6],
                                flexShrink: 0
                            }}
                            onClick={() => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#route-${route.id}`)}
                            title="Copy link to this route"
                        />
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
                        {issues.length > 0 && (
                            <Badge
                                component="button"
                                type="button"
                                color="red"
                                variant={hasFlagged ? "filled" : "light"}
                                size="sm"
                                leftSection={<IconFlag size={13} />}
                                style={{ cursor: "pointer", flexShrink: 0 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openIssuesModal();
                                }}
                                title={hasFlagged && primaryIssue?.flaggedMessage
                                    ? `Safety Notice: ${primaryIssue.flaggedMessage} (Click to view issue details)`
                                    : "Click to view issue details and attachments"}
                            >
                                {hasFlagged
                                    ? (issues.length > 1 ? `${issues.length} Issues (Safety Notice)` : "Safety Notice")
                                    : (issues.length > 1
                                        ? `${issues.length} Issues`
                                        : (primaryIssue.subIssueType
                                            ? `${primaryIssue.issueType} - ${primaryIssue.subIssueType}`
                                            : primaryIssue.issueType))}
                            </Badge>
                        )}
                    </Group>
                </Grid.Col>
                
                {/* Row 2: Details */}
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
                
                {/* Row 3: Notes */}
                {route.notes && (
                    <Grid.Col span={12} mt="xs">
                        <Box style={{ fontSize: theme?.fontSizes?.sm ?? 'var(--mantine-font-size-sm)' }}>
                            <RichTextViewer content={route.notes} />
                        </Box>
                    </Grid.Col>
                )}
            </Grid>

            {issues.length > 0 && (
                <RouteIssuesModal
                    opened={isIssuesModalOpen}
                    onClose={closeIssuesModal}
                    route={route}
                />
            )}
        </Paper>
    );
} 