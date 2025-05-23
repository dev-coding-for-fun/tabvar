import React, { useEffect, useState } from 'react';
import { Modal, TextInput, Button, Group, Textarea, Select, Checkbox, Stack, Paper, MultiSelect } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useFetcher } from '@remix-run/react';
import { IssueType, SubIssueType, issueTypes, subIssuesByType } from '~/lib/constants';
import { Issue } from '~/lib/models';

interface IssueDetailsModalProps {
    issue: Issue;
    initialDescription?: string;
    opened: boolean;
    onClose: () => void;
}

const IssueDetailsModal: React.FC<IssueDetailsModalProps> = ({
    issue,
    opened,
    onClose,
}) => {
    const [issueType, setIssueType] = useState<IssueType | null>(issue.issueType as IssueType | null);
    const [subIssueType, setSubIssueType] = useState<SubIssueType | null>(issue.subIssueType as SubIssueType | null);
    const [selectedBolts, setSelectedBolts] = useState<string[]>(issue.boltsAffected ? issue.boltsAffected.split(',') : []);
    const [boltCount, setBoltCount] = useState<number | null>(issue.route?.boltCount ?? 20);
    const fetcher = useFetcher();

    // Update sub-issue type options based on the selected issue type
    useEffect(() => {
        if (!issueType) {
            setSubIssueType(null);
        } else if (subIssueType && !subIssuesByType[issueType].includes(subIssueType)) {
            setSubIssueType(null);
        }
    }, [issueType, subIssueType]);

    // Monitor fetcher state and show notifications
    useEffect(() => {
        if (fetcher.state === 'idle' && fetcher.data) {
            const response = fetcher.data as { success: boolean; message?: string; error?: string };
            
            if (response.success) {
                notifications.show({
                    title: 'Success',
                    message: response.message || 'Issue updated successfully',
                    color: 'green',
                });
                onClose();
            } else {
                const errorMessage = response.message || response.error || 'Failed to update issue';
                console.error('Issue update failed:', errorMessage);
                notifications.show({
                    title: 'Error',
                    message: errorMessage,
                    color: 'red',
                });
            }
        }
    }, [fetcher.state, fetcher.data, onClose]);

    const handleSave = () => {
        // onClose will be called by the useEffect when submission is successful
    };

    const handleIssueTypeChange = (value: string | null) => {
        setIssueType(value as IssueType | null);
    };

    const handleSubIssueTypeChange = (value: string | null) => {
        setSubIssueType(value as SubIssueType | null);
    };

    const boltOptions = Array.from({ length: boltCount ?? 20 }, (_, i) => ({ value: `${i + 1}`, label: `Bolt ${i + 1}` }));
    boltOptions.push({ value: "Anchor", label: "Anchor" });

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={`Issue Details (id: ${issue.id})`}
            size="lg"
            padding="md"
            centered
        >
            <fetcher.Form method="post" action="/issues/manage">
                <input type="hidden" name="action" value="updateIssue" />
                <input type="hidden" name="issueId" value={issue.id.toString()} />
                <Stack>
                    <TextInput
                        label="Route"
                        value={issue.route?.name ?? ''}
                        readOnly
                    />

                    <TextInput
                        label="Issue Status"
                        value={issue.status}
                        readOnly
                    />
                    <Select
                        label="Issue Type"
                        name="issueType"
                        value={issueType}
                        onChange={handleIssueTypeChange}
                        data={issueTypes}
                    />
                    <Select
                        label="Issue Subtype"
                        name="subIssueType"
                        value={subIssueType}
                        onChange={handleSubIssueTypeChange}
                        data={issueType ? subIssuesByType[issueType].map(subIssue => ({ value: subIssue, label: subIssue })) : []}
                        disabled={!issueType}
                    />
                    {issueType === 'Bolts' && (
                        <MultiSelect
                            name="boltNumbers"
                            data={boltOptions}
                            placeholder="Select bolt numbers"
                            value={selectedBolts}
                            onChange={setSelectedBolts}
                        />
                    )}
                    <Textarea
                        autosize
                        minRows={5}
                        label="Description"
                        name="description"
                        defaultValue={issue.description ?? ""}
                    />
                    <Paper withBorder p="md">
                        <Checkbox
                            label="Safety Flagged"
                            name="isFlagged"
                            defaultChecked={(issue.isFlagged ?? false)}
                        />
                        <Textarea
                            autosize
                            minRows={3}
                            name="safetyNotice"
                            label="Safety Notice"
                            defaultValue={issue.flaggedMessage ?? ""}
                        />
                    </Paper>

                    <Group mt="md">
                        <Button variant="default" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" onClick={handleSave}>
                            {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                        </Button>
                    </Group>
                </Stack>
            </fetcher.Form>
        </Modal>
    );
};

export default IssueDetailsModal;
