import { ActionIcon, Badge, Button, Center, Container, Group, Modal, Popover, Select, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ActionFunction, LoaderFunction, json, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import { IconClick, IconSquareKey, IconUserMinus, IconX } from "@tabler/icons-react";
import { User } from "kysely-codegen";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { useState } from "react";
import { useErrorNotification } from "~/components/useErrorNotification";
import { authenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR, userRoles } from "~/lib/constants";
import { getDB } from "~/lib/db";

export const loader: LoaderFunction = async ({ request, context }) => {
    const user: User = await authenticator.isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ users: [], error: PERMISSION_ERROR }, { status: 403 });
    }
    const db = getDB(context);
    const result = await db.selectFrom('user')
        .selectAll()
        .execute();
    return json({ users: result });
}

export const action: ActionFunction = async ({ request, context }) => {
    const formData = await request.formData();
    const action = formData.get("action");
    const userId = formData.get("uid")?.toString();
    const email = formData.get("email");
    const role = formData.get("role")?.toString();
    if (userId) {
        if (action == "delete" && email != "dserink@gmail.com") {
            const db = getDB(context);
            await db.deleteFrom('signin_event')
                .where('uid', '=', userId)
                .execute();
            await db.deleteFrom('user')
                .where('uid', '=', userId)
                .execute();
            console.log(`deleting user with email ${email}`);
        }
        else if (action == "set_role") {
            if (role) {
                const db = getDB(context);
                await db.updateTable('user')
                    .set({ role: role})
                    .where('uid', '=', userId)
                    .execute();
                console.log(`Set role '${role}' on uid '${userId}'`);
            }
        }
    }
    return redirect("/users");
}

export default function UsersIndex() {
    const data = useLoaderData<{ users: User[], error?: string }>();
    const submit = useSubmit();
    const [isOpen, { close, toggle }] = useDisclosure(false);
    const [selectedRole, setSelectedRole] = useState<string | null>("");
    useErrorNotification(data.error);

    const handleRoleSave = (uid: string | undefined) => {
        const formData = new FormData();
        formData.append('action', 'set_role');
        formData.append('uid', uid ?? "");
        formData.append('role', selectedRole ?? "");
        submit(formData, { method: 'post' });
        close();
    };

    const renderActions: DataTableColumn['render'] = (record: Partial<User>) => (
        <Group gap={4} wrap="nowrap">
            <Form method="post">
                <input type="hidden" name="action" value="delete" />
                <input type="hidden" name="uid" value={record.uid} />
                <input type="hidden" name="email" value={record.email ?? ""} />
                <ActionIcon
                    size="sm"
                    variant="transparent"
                    color="red"
                    type="submit"
                    onClick={(e) => {
                        e.stopPropagation();
                        console.log(`clicked delete on ${record.email}`);
                    }}>
                    <IconUserMinus size={16} />
                </ActionIcon>
            </Form>
            <Popover
                width={200}
                position="bottom"
                withArrow
                withinPortal
                opened={isOpen}
                onClose={close}
                trapFocus
            ><Popover.Target>
                    <ActionIcon
                        size="sm"
                        variant="transparent"
                        color="indigo"
                        onClick={(e) => {
                            e.preventDefault();
                            toggle();
                        }}
                    >
                        <IconSquareKey size={16} />
                    </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown
                    onClick={(e) => e.preventDefault()}>
                    <Stack>
                        <Select
                            label="Assign Role"
                            comboboxProps={{ withinPortal: false }}
                            data={userRoles}
                            value={selectedRole}
                            onChange={setSelectedRole}
                        />
                        <Button onClick={() => handleRoleSave(record.uid)} type="submit">Save</Button>
                    </Stack>
                </Popover.Dropdown>
            </Popover>
        </Group>
    );

    return (
        <Container size="xl" p="md">
            <DataTable
                withTableBorder
                borderRadius="sm"
                withColumnBorders
                striped
                highlightOnHover
                records={data.users}
                columns={[
                    {
                        accessor: "display_name",
                        render: (record) =>
                            <Group key={record.uid}>
                                <Text>{record.display_name}</Text>
                                <Badge size="xs" color="sector-color">{record.role}</Badge>
                            </Group>,
                    },
                    {
                        accessor: "email",
                    },
                    {
                        accessor: "email_verified",
                    },
                    {
                        accessor: "actions",
                        title: (<Center><IconClick size={16} /></Center>),
                        width: '0%',
                        render: renderActions,
                    },
                ]}

            />
        </Container>
    );
}
