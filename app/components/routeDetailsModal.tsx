import React from 'react';
import { Modal, TextInput, NumberInput, Select, Button, Group, Stack } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useFetcher } from '@remix-run/react';
import { Route } from '~/lib/models';
import { YDS_GRADES } from '~/lib/constants';


interface RouteModalProps {
    route?: Route;
    opened: boolean;
    onClose: () => void;
}

const RouteDetailsModal: React.FC<RouteModalProps> = ({ route, opened, onClose }) => {
    const fetcher = useFetcher();
    const isEditing = !!route;

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Handle form submission logic here
        onClose();
    };

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={isEditing ? `Edit Route: ${route.name}` : 'Create New Route'}
            size="lg"
            padding="md"
            centered
        >
            <fetcher.Form method="post" action="/routes/manage" onSubmit={handleSubmit}>
                <input type="hidden" name="action" value={isEditing ? "updateRoute" : "createRoute"} />
                {isEditing && <input type="hidden" name="routeId" value={route.id?.toString()} />}
                <Stack>
                    <TextInput
                        label="Sector"
                        name="sector"
                        required
                        defaultValue={route?.sectorId?.toString()}
                    />
                    <TextInput
                        label="Route Name"
                        name="name"
                        required
                        defaultValue={route?.name}
                    />
                    <TextInput
                        label="Alternate Name"
                        name="altName"
                        defaultValue={route?.altNames?.toString()}
                    />
                    <NumberInput
                        label="Bolt Count"
                        name="boltCount"
                        required
                        min={0}
                        defaultValue={route?.boltCount?.toString()}
                    />
                    <Select
                        label="Climb Style"
                        name="style"
                        required
                        data={[
                            { value: 'Sport', label: 'Sport' },
                            { value: 'Trad', label: 'Trad' },
                        ]}
                        defaultValue={route?.climbStyle}
                    />
                    <TextInput
                        label="First Ascensionist"
                        name="firstAscensionist"
                        defaultValue={route?.firstAscentBy?.toString()}
                    />
                    <DateInput
                        label="First Ascent Date"
                        name="firstAscentDate"
                        //defaultValue={}
                    />
                    <Select
                        label="Grade"
                        name="grade"
                        required
                        data={YDS_GRADES.map(grade => ({ value: grade, label: grade }))}
                        defaultValue={route?.gradeYds}
                    />
                    <NumberInput
                        label="Length (meters)"
                        name="length"
                        required
                        min={0}
                        defaultValue={route?.routeLength?.toString()}
                    />
                    <NumberInput
                        label="Sort Order"
                        name="sortOrder"
                        required
                        defaultValue={route?.sortOrder?.toString()}
                    />
                    <Group mt="md">
                        <Button variant="default" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button disabled type="submit">
                            {fetcher.state !== 'idle' ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
                        </Button>
                        <span>🚧 Under Construction 🚧</span>
                    </Group>
                </Stack>
            </fetcher.Form>
        </Modal>
    );
}

export default RouteDetailsModal;