import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme, TextInput, ActionIcon, Select, NumberInput, Textarea } from "@mantine/core";
import { IconFlag, IconCheck, IconX } from "@tabler/icons-react";
import { CLIMB_STYLES, getGradeColor, getGradesbyStyle } from "~/lib/constants";
import type { Route } from "~/lib/models";
import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { ConfiguredRichTextEditor } from "./ConfiguredRichTextEditor";

interface ActionData {
    success: boolean;
    error?: string;
}

interface RouteEditCardProps {
    route: Partial<Route>;
    theme: MantineTheme;
    onCancel: () => void;
    isNew?: boolean;
}

export function RouteEditCard({ route, theme, onCancel, isNew }: RouteEditCardProps) {
    const [routeLength, setRouteLength] = useState<number | undefined>(route.routeLength ?? undefined);
    const [climbStyle, setClimbStyle] = useState<string>(route.climbStyle ?? '');
    const [availableGrades, setAvailableGrades] = useState<string[]>(getGradesbyStyle(route.climbStyle ?? ''));
    const fetcher = useFetcher<ActionData>();

    useEffect(() => {
        if (fetcher.state === 'idle' && fetcher.data?.success) {
            onCancel();
        }
    }, [fetcher.state, fetcher.data, onCancel]);

    return (
        <fetcher.Form method="post" style={{ flex: 1, display: 'flex' }}>
            <input type="hidden" name="action" value={isNew ? "create_route" : "update_route"} />
            <input type="hidden" name="routeId" value={route.id?.toString()} />
            <input type="hidden" name="sectorId" value={route.sectorId?.toString()} />
            <Paper
                p="xs"
                withBorder
                style={{
                    borderLeft: `${rem(6)} solid ${getGradeColor(route.gradeYds ?? '')}`,
                    flex: 1
                }}
            >
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs">
                            <TextInput
                                name="name"
                                defaultValue={route.name}
                                size="xs"
                                placeholder="Route Name"
                                styles={{ 
                                    input: { fontSize: 'var(--mantine-font-size-sm)' },
                                    root: { minWidth: rem(300) }
                                }}
                            />
                            <Select
                                name="gradeYds"
                                defaultValue={route.gradeYds ?? ''}
                                size="xs"
                                data={["?"].concat(availableGrades)}
                                placeholder="Grade"
                                styles={{ 
                                    input: { fontSize: 'var(--mantine-font-size-sm)', width: '80px', textAlign: 'right' },
                                    root: { flexShrink: 0 }
                                }}
                            />
                        </Group>
                        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                            <NumberInput
                                name="year"
                                defaultValue={route.year ?? undefined}
                                size="xs"
                                placeholder="Year"
                                styles={{ input: { width: '60px' } }}
                                min={1900}
                                max={new Date().getFullYear()}
                            />
                            {route.sortOrder != null && (
                                <Text size="xs" c="dimmed">
                                    #{route.sortOrder}
                                </Text>
                            )}
                        </Group>
                    </Group>
                    
                    <Group justify="space-between">
                        <Group>
                            <Select
                                name="climbStyle"
                                defaultValue={route.climbStyle ?? ''}
                                size="xs"
                                data={[""].concat(CLIMB_STYLES)}
                                placeholder="Style"
                                styles={{ input: { width: '110px' } }}
                                onChange={(value) => {
                                    setClimbStyle(value ?? '');
                                    setAvailableGrades(getGradesbyStyle(value ?? ''));
                                }}
                            />
                            <NumberInput
                                name="boltCount" 
                                defaultValue={route.boltCount ?? undefined}
                                size="xs"
                                placeholder="Bolts"
                                styles={{ input: { width: '50px' } }}
                                min={0}
                            /><Text size="xs" ml={-12}>Bolts</Text>
                            <NumberInput
                                name="pitchCount"
                                defaultValue={route.pitchCount ?? undefined}
                                size="xs"
                                placeholder="#"
                                styles={{ input: { width: '50px' } }}
                                min={1}
                            /><Text size="xs" ml={-12}>Pitches</Text>
                            <NumberInput
                                name="routeLength"
                                defaultValue={route.routeLength ?? undefined}
                                size="xs"
                                placeholder="Length (m)"
                                styles={{ input: { width: '80px' } }}
                                min={0}
                                onChange={(value) => setRouteLength(typeof value === 'number' ? value : undefined)}
                            /><Text size="xs" ml={-12}>Meters ({routeLength ? Math.round(routeLength * 3.28084) : '-'} ft)</Text>
                            
                            <Group gap="xs" wrap="nowrap">
                                <Text size="xs">FA:</Text>
                                <TextInput
                                    name="firstAscentBy"
                                    defaultValue={route.firstAscentBy ?? ''}
                                    size="xs"
                                    placeholder="First Ascent By"
                                    styles={{ input: { width: '160px' } }}
                                />
                            </Group>
                        </Group>
                    </Group>
                    
                    <ConfiguredRichTextEditor
                      name="notes"
                      initialContent={route.notes ?? ''}
                      mt="xs"
                    />

                    <Group justify="flex-end" mt="xs" gap="xs">
                        <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={onCancel}
                            title="Cancel"
                        >
                            <IconX size={16} />
                        </ActionIcon>
                        <ActionIcon
                            variant="subtle"
                            color="green"
                            type="submit"
                            title={isNew ? "Create Route" : "Save Changes"}
                        >
                            <IconCheck size={16} />
                        </ActionIcon>
                    </Group>
                </Stack>
            </Paper>
        </fetcher.Form>
    );
} 