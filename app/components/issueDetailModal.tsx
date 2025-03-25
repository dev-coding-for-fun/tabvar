import React, { useEffect, useState } from 'react';
import { Modal, TextInput, Button, Group, Textarea, Select, Checkbox, Stack, Paper } from '@mantine/core';
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
    const fetcher = useFetcher();

    // Update sub-issue type options based on the selected issue type
    useEffect(() => {
        if (!issueType) {
            setSubIssueType(null);
        } else if (subIssueType && !subIssuesByType[issueType].includes(subIssueType)) {
            setSubIssueType(null);
        }
    }, [issueType, subIssueType]);

    const handleSave = () => {
        onClose();
    };

    const handleIssueTypeChange = (value: string | null) => {
        setIssueType(value as IssueType | null);
    };

    const handleSubIssueTypeChange = (value: string | null) => {
        setSubIssueType(value as SubIssueType | null);
    };

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
                        value={issue.routeName}
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

                    <Textarea
                        autosize
                        minRows={5}
                        label="Description"
                        name="description"
                        defaultValue={issue.description ?? ""}
                    />
                    <Paper withBorder p="sm">
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
