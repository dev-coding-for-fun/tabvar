import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme } from "@mantine/core";
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
                <Group justify="space-between">
                    <Group gap="xs">
                        {route.issues.length > 0 && (
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

                {route.issues.length > 0 && (
                    <Stack gap="xs">
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

                <Group align="flex-start" justify="flex-start" gap="lg">
                    <Stack gap={2}>
                        <Text size="xs" c="dimmed">
                            {route.climbStyle}
                            {route.boltCount ? ` • ${route.boltCount} bolts` : ''}
                            {route.pitchCount && route.pitchCount > 1 ? ` • ${route.pitchCount} pitches` : ''}
                            {route.routeLength ? ` • ${route.routeLength}m (${Math.round(route.routeLength * 3.28084)}ft)` : ''}
                        </Text>

                        {route.firstAscentBy && (
                            <Text size="xs" c="dimmed" fs="italic">
                                First Ascent: {route.firstAscentBy}
                            </Text>
                        )}
                    </Stack>

                    <TopoGallery
                        attachments={route.attachments ?? []}
                        routeId={route.id}
                        canEdit={canEdit}
                        size="xs"
                    />
                </Group>
            </Stack>
            {canEdit && (
                <Stack
                    gap={0}
                    style={{
                        position: 'absolute',
                        right: 8,
                        bottom: 8,
                        opacity: 0.6,
                        alignItems: 'flex-end'
                    }}
                >
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
        </Paper>
    );
} 