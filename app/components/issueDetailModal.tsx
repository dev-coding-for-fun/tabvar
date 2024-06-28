import React, { useEffect, useState } from 'react';
import { Modal, TextInput, Text, Button, Group, Textarea, Select, Checkbox, Stack, Paper } from '@mantine/core';
import { IssueWithRoute } from '~/routes/issues._index';
import { useNavigation } from '@remix-run/react';
import { IssueType, SubIssueType, issueTypes, subIssuesByType } from '~/lib/constants';

interface IssueDetailsModalProps {
    issue: IssueWithRoute;
    initialDescription?: string;
    opened: boolean;
    onClose: () => void;
    //onSave: (description: string) => void;
}

const IssueDetailsModal: React.FC<IssueDetailsModalProps> = ({
    issue,
    opened,
    onClose,
    //onSave,
}) => {
    const [issueType, setIssueType] = useState<IssueType | null>(issue.issue_type as IssueType | null);
    const [subIssueType, setSubIssueType] = useState<SubIssueType | null>(issue.sub_issue_type as SubIssueType | null);
    const navigation = useNavigation();

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

    const handleCancel = () => {
        onClose();
    }

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
            title={`Issue Details - ID: ${issue.id}`}
            size="lg"
            padding="md"
            centered
        >
            <form method="post">
                <input type="hidden" name="issueId" value={issue.id.toString()} />
                <Stack>
                    <Paper withBorder p="sm">
                        <TextInput
                            label="Route"
                            value={issue.route_name}
                            disabled

                        />
                        <Text>{issue.status}</Text>
                    </Paper>
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
                            defaultChecked={(issue.is_flagged ?? 0) > 0}
                        />
                        <Textarea
                            autosize
                            minRows={3}
                            name="safetyNotice"
                            label="Safety Notice"
                            defaultValue={issue.flagged_message ?? ""}
                        />
                    </Paper>

                    <Group mt="md">
                        <Button variant="default" onClick={handleCancel} disabled={navigation.state !== "idle"}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={navigation.state !== "idle"}>
                            {navigation.state !== 'idle' ? 'Saving...' : 'Save'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
};

export default IssueDetailsModal;
