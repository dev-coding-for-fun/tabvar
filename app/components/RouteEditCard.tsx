import { Paper, Stack, Group, Text, rem, Box, Button, MantineTheme, TextInput, ActionIcon, Select, NumberInput } from "@mantine/core";
import { IconFlag, IconCheck, IconX } from "@tabler/icons-react";
import { CLIMB_STYLES, getGradeColor, getGradesbyStyle } from "~/lib/constants";
import type { Route } from "~/lib/models";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";

interface TruncatableDescriptionProps {
    description: string;
    fz: string;
}

const TruncatableDescription: React.FC<TruncatableDescriptionProps> = ({ description, fz }) => {
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
                    flex: 1,
                }}
            >
                <Stack gap={2}>
                    <Group justify="space-between">
                        <Group gap="xs">
                            {route.issues && route.issues.length > 0 && (
                                <IconFlag size={18} style={{ color: theme.colors.red[6] }} />
                            )}
                            <TextInput
                                name="name"
                                defaultValue={route.name}
                                size="xs"
                                placeholder="Route Name"
                                styles={{ input: { fontSize: 'var(--mantine-font-size-sm)' } }}
                                style={{ flex: 1 }}
                            />
                        </Group>
                        <Select
                            name="gradeYds"
                            defaultValue={route.gradeYds ?? ''}
                            size="xs"
                            data={availableGrades}
                            placeholder="Grade"
                            styles={{ input: { fontSize: 'var(--mantine-font-size-sm)', width: '80px', textAlign: 'right' } }}
                        />
                    </Group>
                    
                    {route.issues && route.issues.length > 0 && (
                        <Stack gap="xs">
                            <Text size="sm" c="red" fw={500}>
                                Issue: {route.issues[0].issueType}{route.issues[0].subIssueType ? ` - ${route.issues[0].subIssueType}` : ''}
                            </Text>
                            {route.issues[0].description && (
                                <TruncatableDescription description={route.issues[0].description} fz="sm" />
                            )}
                            {route.issues[0].flaggedMessage && (
                                <Text size="sm" c="red.7" fw={500}>
                                    ⚠️ Safety Notice: {route.issues[0].flaggedMessage}
                                </Text>
                            )}
                        </Stack>
                    )}
                    
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
                    </Group>
                    <Group gap="xs">
                        <Text size="xs">First Ascent:</Text>
                        <TextInput
                            name="firstAscentBy"
                            defaultValue={route.firstAscentBy ?? ''}
                            size="xs"
                            placeholder="First Ascent By"
                            styles={{ input: { width: '202px' } }}
                        />
                    </Group>

                    <Group justify="flex-end" mt="xs">
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