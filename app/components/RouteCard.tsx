import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme, Flex } from "@mantine/core";
import { IconFlag } from "@tabler/icons-react";
import { getGradeColor } from "~/lib/constants";
import type { Route } from "~/lib/models";
import { TopoGallery } from "./TopoGallery";
import { useFetcher } from "@remix-run/react";

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
            <Stack gap={2}>
                {/* Row 1: Name/Issues and Grade */}
                <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2} style={{ flexShrink: 1 }}>
                        <Group gap="xs" wrap="nowrap">
                          {route.issues.length > 0 && (
                              <IconFlag size={18} style={{ color: theme.colors.red[6], flexShrink: 0 }} />
                          )}
                          <Text size="md" fw={500} truncate="end">
                              {route.name}
                          </Text>
                          <TopoGallery
                              attachments={route.attachments ?? []}
                              routeId={route.id}
                              canEdit={canEdit}
                              size="xs"
                          />
                        </Group>
                        {/* Issues moved below main content */}
                    </Stack>
                    <Text size="md" c="dimmed" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {route.gradeYds}
                    </Text>
                </Group>

                {/* Row 2: Details, Notes, Gallery */}
                <Group mt={4} align="flex-end" gap="md" grow wrap="nowrap">
                    {/* Column 1: Climb Details & FA */}
                    <Stack gap={2} style={{ flexBasis: '45%', minWidth: '150px' }}>
                        <Text size="xs" c="dimmed">
                            {route.climbStyle}
                            {route.boltCount ? ` • ${route.boltCount} bolts` : ''}
                            {route.pitchCount && route.pitchCount > 1 ? ` • ${route.pitchCount} pitches` : ''}
                            {route.routeLength ? ` • ${route.routeLength}m (${Math.round(route.routeLength * 3.28084)}ft)` : ''}
                        </Text>

                        {/* FA info back to simple Text */}
                        {route.firstAscentBy && (
                            <Text size="xs" c="dimmed" fs="italic">
                                First Ascent: {route.firstAscentBy}
                            </Text>
                        )}
                    </Stack>

                    {/* Column 2: Notes */}
                    {route.notes && (
                        <Stack gap={2} style={{ flexBasis: '45%', minWidth: '150px' }}>
                            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                                {route.notes}
                            </Text>
                        </Stack>
                    )}

                    {/* Column 3: Admin Info (Year, SortOrder) - Re-added */}
                    {canEdit && (
                      <Stack gap={0} align="flex-end" style={{ flexBasis: '10%', minWidth: '40px' }}>
                        {route.year && (
                          <Text size="xs" c="dimmed">
                              {route.year}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                            #{route.sortOrder ?? '-'}
                        </Text>
                      </Stack>
                    )}
                </Group>

                {/* Issues Display (below main content) */}
                {route.issues.length > 0 && (
                    <Stack gap="xs" mt="sm">
                        <Text size="sm" c="red" fw={500}>
                            Issue: {route.issues[0].issueType}{route.issues[0].subIssueType ? ` - ${route.issues[0].subIssueType}` : ''}
                        </Text>
                        {route.issues[0].description && (
                            <Text size="sm" lineClamp={3}>
                                {route.issues[0].description}
                            </Text>
                        )}
                        {route.issues[0].flaggedMessage && (
                            <Text size="sm" c="red.7" fw={500}>
                                ⚠️ Safety Notice: {route.issues[0].flaggedMessage}
                            </Text>
                        )}
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
} 