import {
    Modal,
    Stack,
    Paper,
    Group,
    Badge,
    Text,
    Box,
    Alert,
    SimpleGrid,
    Card,
    Image,
    Button,
    rem,
} from "@mantine/core";
import { IconAlertTriangle, IconFlag, IconPaperclip } from "@tabler/icons-react";
import type { Route, Issue } from "~/lib/models";

interface RouteIssuesModalProps {
    opened: boolean;
    onClose: () => void;
    route: Route;
}

function getStatusColor(status?: string | null): string {
    if (!status) return "gray";
    switch (status.toLowerCase()) {
        case "open":
        case "reported":
            return "orange";
        case "viewed":
        case "claimed":
        case "in_progress":
            return "blue";
        case "resolved":
        case "completed":
        case "closed":
            return "green";
        case "archived":
            return "gray";
        default:
            return "gray";
    }
}

export function RouteIssuesModal({ opened, onClose, route }: RouteIssuesModalProps) {
    const issues: Issue[] = route.issues ?? [];

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Group gap="xs">
                    <IconFlag size={20} color="var(--mantine-color-red-6)" />
                    <Text fw={600} size="md">
                        {issues.length > 1 ? `Issues for ${route.name} (${issues.length})` : `Issue Details – ${route.name}`}
                    </Text>
                </Group>
            }
            size="lg"
            padding="md"
            centered
            transitionProps={{ duration: 0 }}
        >
            {issues.length === 0 ? (
                <Text size="sm" c="dimmed">
                    No issues reported for this route.
                </Text>
            ) : (
                <Stack gap="md">
                    {issues.map((issue) => {
                        const reportDate = issue.reportedAt || issue.createdAt;
                        const attachments = issue.attachments ?? [];

                        return (
                            <Paper key={issue.id} withBorder p="md" radius="sm">
                                <Stack gap="xs">
                                    {/* Header: Type, SubType, Status, Bolts, Date */}
                                    <Group justify="space-between" wrap="wrap" gap="xs">
                                        <Group gap="xs">
                                            <Badge color="red" variant="light" size="md">
                                                {issue.issueType}
                                                {issue.subIssueType ? ` • ${issue.subIssueType}` : ""}
                                            </Badge>
                                            <Badge color={getStatusColor(issue.status)} variant="outline" size="sm">
                                                {issue.status}
                                            </Badge>
                                            {issue.boltsAffected && (
                                                <Badge color="gray" variant="subtle" size="sm">
                                                    Bolts: {issue.boltsAffected}
                                                </Badge>
                                            )}
                                        </Group>
                                        {(reportDate || issue.reportedBy) && (
                                            <Text size="xs" c="dimmed">
                                                {reportDate
                                                    ? new Date(reportDate).toLocaleDateString(undefined, {
                                                          year: "numeric",
                                                          month: "short",
                                                          day: "numeric",
                                                      })
                                                    : ""}
                                                {reportDate && issue.reportedBy ? " • " : ""}
                                                {issue.reportedBy ? `Reported by ${issue.reportedBy}` : ""}
                                            </Text>
                                        )}
                                    </Group>

                                    {/* Safety Notice if flagged */}
                                    {(issue.isFlagged || issue.flaggedMessage) && (
                                        <Alert
                                            color="red"
                                            variant="light"
                                            title="Safety Notice"
                                            icon={<IconAlertTriangle size={18} />}
                                        >
                                            {issue.flaggedMessage || "This issue has been flagged as a safety concern."}
                                        </Alert>
                                    )}

                                    {/* Description */}
                                    {issue.description && (
                                        <Box mt={4}>
                                            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                                                Description
                                            </Text>
                                            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                                {issue.description}
                                            </Text>
                                        </Box>
                                    )}

                                    {/* Attachments */}
                                    {attachments.length > 0 && (
                                        <Box mt="xs">
                                            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
                                                Attachments ({attachments.length})
                                            </Text>
                                            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                                                {attachments.map((attachment) => {
                                                    const rawUrl = attachment.url || "";
                                                    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
                                                    const isImage =
                                                        !attachment.type ||
                                                        attachment.type.startsWith("image/") ||
                                                        /\.(jpe?g|png|webp|gif|svg)$/i.test(rawUrl);

                                                    if (isImage) {
                                                        return (
                                                            <Card
                                                                key={attachment.id || attachment.url}
                                                                withBorder
                                                                padding={4}
                                                                radius="sm"
                                                                component="a"
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ textDecoration: "none" }}
                                                                title="Click to view full image in new tab"
                                                            >
                                                                <Card.Section>
                                                                    <Image
                                                                        src={url}
                                                                        height={120}
                                                                        fit="cover"
                                                                        alt={attachment.name || "Issue attachment"}
                                                                    />
                                                                </Card.Section>
                                                                {attachment.name && (
                                                                    <Text size="xs" truncate="end" c="dimmed" p={4}>
                                                                        {attachment.name}
                                                                    </Text>
                                                                )}
                                                            </Card>
                                                        );
                                                    }

                                                    return (
                                                        <Paper
                                                            key={attachment.id || attachment.url}
                                                            p="xs"
                                                            withBorder
                                                            radius="sm"
                                                            component="a"
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: rem(8),
                                                                textDecoration: "none",
                                                            }}
                                                            title="Download attachment"
                                                        >
                                                            <IconPaperclip size={18} />
                                                            <Text size="xs" truncate="end">
                                                                {attachment.name || "Attachment"}
                                                            </Text>
                                                        </Paper>
                                                    );
                                                })}
                                            </SimpleGrid>
                                        </Box>
                                    )}
                                </Stack>
                            </Paper>
                        );
                    })}
                </Stack>
            )}

            <Group justify="flex-end" mt="md">
                <Button variant="default" onClick={onClose}>
                    Close
                </Button>
            </Group>
        </Modal>
    );
}
