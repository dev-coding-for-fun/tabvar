import { ActionIcon, Badge, Button, Center, Container, Group, List, Popover, Select, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { ActionFunction, LoaderFunction, json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { IconClick, IconSquareKey, IconTrash, IconUserMinus, IconX } from "@tabler/icons-react";
import { User, UserInvite } from "~/lib/models";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { useEffect, useState } from "react";
import { useErrorNotification } from "~/components/useErrorNotification";
import { getAuthenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR, userRoles } from "~/lib/constants";
import { getDB } from "~/lib/db";

export const loader: LoaderFunction = async ({ request, context }) => {
    const user: User = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ users: [], error: PERMISSION_ERROR }, { status: 403 });
    }
    const db = getDB(context);
    const users = await db.selectFrom('user')
        .selectAll()
        .execute();
    const invites = await db.selectFrom('user_invite')
        .selectAll()
        .execute();
    return json({ users: users, invites: invites });
}

export const action: ActionFunction = async ({ request, context }) => {
    const user: User = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR }, { status: 403 });
    }
    const formData = await request.formData();
    const action = formData.get("action");

    switch (action) {
        case "delete_user": {
            const userId = formData.get("uid")?.toString();
            const email = formData.get("email");
            if (userId && email != "dserink@gmail.com") {
                const db = getDB(context);
                await db.deleteFrom('signin_event')
                    .where('uid', '=', userId)
                    .execute();
                await db.deleteFrom('user')
                    .where('uid', '=', userId)
                    .execute();
                console.log(`deleting user with email ${email}`);
            }
            return json({ success: true });
        }
        case "set_role": {
            const userId = formData.get("uid")?.toString();
            const role = formData.get("role")?.toString();
            if (userId && role) {
                const db = getDB(context);
                await db.updateTable('user')
                    .set({ role: role })
                    .where('uid', '=', userId)
                    .execute();
                console.log(`Set role '${role}' on uid '${userId}'`);
            }
            return json({ success: true });
        }
        case "create_invite": {
            const inviteEmails = formData.get("invite_email")?.toString();
            const inviteName = formData.get("invite_name")?.toString();
            const inviteRole = formData.get("invite_role")?.toString();
            if (inviteEmails && inviteRole) {
                const db = getDB(context);
                const emails = inviteEmails.split(/[,;\s]+/).filter(email => email.trim());
                for (const email of emails) {
                    try {
                        await db.insertInto('user_invite')
                            .values({
                                email: email.trim(),
                                display_name: emails.length === 1 ? inviteName || null : null,
                                role: inviteRole || null,
                                invited_by_uid: user.uid,
                                invited_by_name: user.displayName ?? "",
                                token_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 365 days from now
                            })
                            .execute();
                    } catch (error) {
                        if (error instanceof Error) console.log(error.message);
                        return json({ success: false, message: `Could not create invite. If this email is already invited, delete it first to re-invite.` }, { status: 500 });
                    }
                }
                return json({ success: true, message: `Invite created.` });
            }
            break;
        }
        case "delete_invite": {
            const inviteEmail = formData.get("inviteId")?.toString();
            if (inviteEmail) {
                const db = getDB(context);
                await db.deleteFrom('user_invite')
                    .where('email', '=', inviteEmail)
                    .execute();
                return json({ success: true, message: `Invite deleted.` });
            }
            break;
        }
    }
    return redirect("/users");
}

export default function UsersIndex() {
    const { users, invites, error } = useLoaderData<{ users: User[]; invites: UserInvite[]; error?: string }>();
    const actionData = useActionData<{ success?: boolean; message?: string }>();
    const submit = useSubmit();
    const [isOpen, { close, toggle }] = useDisclosure(false);
    const [selectedRole, setSelectedRole] = useState<string | null>("");
    useErrorNotification(error);

    const handleRoleSave = (uid: string | undefined) => {
        const formData = new FormData();
        formData.append('action', 'set_role');
        formData.append('uid', uid ?? "");
        formData.append('role', selectedRole ?? "");
        submit(formData, { method: 'post' });
        close();
    };

    useEffect(() => {
        if (actionData && actionData?.success) {
            showNotification({
                title: "Success",
                message: actionData.message,
                color: "green",
                autoClose: 3000,
            });
        }
        else if (actionData && actionData?.success == false) {
            showNotification({
                title: 'Error',
                message: actionData.message,
                color: 'red',
                icon: <IconX />,
                autoClose: 3000,
            });
        }
    }, [actionData]);

    const renderActions: DataTableColumn['render'] = (record: Partial<User>) => (
        <Group gap={4} wrap="nowrap">
            <Form method="post">
                <input type="hidden" name="action" value="delete_user" />
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
            <Stack>
                <Title order={2}>Users</Title>
                <DataTable
                    withTableBorder
                    borderRadius="sm"
                    withColumnBorders
                    striped
                    highlightOnHover
                    records={users as Array<User & Record<string, unknown>>}
                    columns={[
                        {
                            accessor: "display_name",
                            render: (record) =>
                                <Group key={record.uid}>
                                    <Text>{record.displayName}</Text>
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
                <Title order={2}>Invite New Users</Title>
                <Form method="post">
                    <input type="hidden" name="action" value="create_invite" />
                    <Stack>
                        <Textarea
                            name="invite_email"
                            label="Email"
                            description="Enter an email or a list of emails separated by a semicolon"
                            required
                        />
                        <TextInput
                            name="invite_name"
                            label="Name (optional, single email invitations only)"
                        />
                        <Select
                            name="invite_role"
                            label="Role"
                            data={userRoles}
                            required
                        />
                        <Button type="submit">Create Invite</Button>
                    </Stack>
                </Form>
                <Title order={2}>Pending Invitations</Title>
                <List spacing="xs">
                    {invites.map((invite) => (
                        <List.Item key={invite.email}>
                            <Group>
                                <Group>
                                    <Text><strong>Email:</strong> {invite.email}</Text>
                                    <Text><strong>Name:</strong> {invite.displayName || 'N/A'}</Text>
                                    <Badge>{invite.role}</Badge>
                                    <Text><strong>Invited by:</strong> {invite.invitedByName}</Text>
                                    <Text><strong>Invitation Expires:</strong> {new Date(invite.tokenExpires as string).toLocaleString()}</Text>
                                </Group>
                                <Form method="post">
                                    <input type="hidden" name="action" value="delete_invite" />
                                    <input type="hidden" name="inviteId" value={invite.email} />
                                    <ActionIcon
                                        color="red"
                                        type="submit"
                                    >
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </Form>
                            </Group>
                        </List.Item>
                    ))}
                </List>
            </Stack>
        </Container>
    );
}
