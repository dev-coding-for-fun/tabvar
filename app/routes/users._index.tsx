import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Container,
    Divider,
    Group,
    List,
    Modal,
    MultiSelect,
    Popover,
    Select,
    Stack,
    Text,
    Textarea,
    TextInput,
    Title,
    Tooltip,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { showNotification } from "@mantine/notifications";
import {
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
    data,
    redirect,
    type MetaFunction,
    Form,
    Link,
    useActionData,
    useLoaderData,
    useSubmit,
} from "react-router";
import {
    IconClick,
    IconPlus,
    IconRefresh,
    IconSquareKey,
    IconTag,
    IconTags,
    IconTrash,
    IconUserMinus,
    IconX,
} from "@tabler/icons-react";
import type { User, UserAssignedTag, UserInvite, UserTag, UserWithTags } from "~/lib/models";
import { DataTable } from "mantine-datatable";
import { useEffect, useState } from "react";
import { useErrorNotification } from "~/components/useErrorNotification";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR, userRoles } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { privatePageMeta } from "~/lib/seo";
import { addInviteTags, getInviteTagsMap } from "~/lib/tags.server";

export const loader = async (args: LoaderFunctionArgs) => {
    const user: User = await requireUser(args);
    if (user.role !== 'admin') {
        return data({ users: [], invites: [], tags: [], error: PERMISSION_ERROR }, { status: 403 });
    }
    const db = getDB(args.context);
    const users = await db.selectFrom('user')
        .selectAll()
        .execute();
    const invites = await db.selectFrom('user_invite')
        .selectAll()
        .execute();
    const tags = await db.selectFrom('user_tag')
        .selectAll()
        .orderBy('name', 'asc')
        .execute();

    const assignments = await db
        .selectFrom('user_tag_assignment as a')
        .innerJoin('user_tag as t', 'a.tag_id', 't.id')
        .select([
            'a.id as assignmentId',
            'a.uid as uid',
            'a.tag_id as tagId',
            't.name as name',
            't.description as description',
            't.color as color',
            'a.expires_at as expiresAt',
        ])
        .orderBy('t.name', 'asc')
        .execute();

    const now = new Date();
    const userTagsMap = new Map<string, UserAssignedTag[]>();
    for (const row of assignments) {
        const isExpired = row.expiresAt ? new Date(row.expiresAt) < now : false;
        const list = userTagsMap.get(row.uid) || [];
        list.push({
            assignmentId: Number(row.assignmentId),
            tagId: Number(row.tagId),
            name: row.name,
            description: row.description,
            color: row.color || 'blue',
            expiresAt: row.expiresAt,
            isExpired,
        });
        userTagsMap.set(row.uid, list);
    }

    const usersWithTags = users.map((u) => ({
        ...u,
        tags: userTagsMap.get(u.uid) || [],
    }));

    const inviteTagsMap = await getInviteTagsMap(db);
    const invitesWithTags = invites.map((inv) => ({
        ...inv,
        tags: inviteTagsMap.get(inv.email.trim().toLowerCase()) || [],
    }));

    return {
        users: usersWithTags,
        invites: invitesWithTags,
        tags: tags.map((t) => ({
            id: Number(t.id),
            name: t.name,
            description: t.description,
            color: t.color || 'blue',
        })),
    };
};

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("Users");

export const action = async (args: ActionFunctionArgs) => {
    const user: User = await requireUser(args);
    const { request, context } = args;
    if (user.role !== 'admin') {
        return data({ error: PERMISSION_ERROR }, { status: 403 });
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
            return data({ success: true });
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
            return data({ success: true });
        }
        case "create_invite": {
            const inviteEmails = formData.get("invite_email")?.toString();
            const inviteName = formData.get("invite_name")?.toString();
            const inviteRole = formData.get("invite_role")?.toString();
            const rawTags = formData.getAll("invite_tags");
            const inviteTags = rawTags
                .map((t) => Number(t.toString()))
                .filter((id) => !isNaN(id) && id > 0);

            if (inviteEmails && inviteRole) {
                const db = getDB(context);
                const emails = inviteEmails.split(/[,;\s]+/).filter(email => email.trim());
                for (const email of emails) {
                    const normalizedEmail = email.trim().toLowerCase();
                    try {
                        await db.insertInto('user_invite')
                            .values({
                                email: normalizedEmail,
                                display_name: emails.length === 1 ? inviteName || null : null,
                                role: inviteRole || null,
                                invited_by_uid: user.uid,
                                invited_by_name: user.displayName ?? "",
                                token_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 365 days from now
                            })
                            .execute();

                        if (inviteTags.length > 0) {
                            await addInviteTags(db, normalizedEmail, inviteTags);
                        }
                    } catch (error) {
                        if (error instanceof Error) console.log(error.message);
                        return data({ success: false, message: `Could not create invite. If this email is already invited, delete it first to re-invite.` }, { status: 500 });
                    }
                }
                return data({ success: true, message: `Invite created.` });
            }
            break;
        }
        case "delete_invite": {
            const inviteEmail = formData.get("inviteId")?.toString();
            if (inviteEmail) {
                const db = getDB(context);
                await db.deleteFrom('user_invite_tag')
                    .where('email', '=', inviteEmail.trim().toLowerCase())
                    .execute();
                await db.deleteFrom('user_invite')
                    .where('email', '=', inviteEmail)
                    .execute();
                return data({ success: true, message: `Invite deleted.` });
            }
            break;
        }
        case "assign_tag": {
            const userId = formData.get("uid")?.toString();
            const tagId = Number(formData.get("tag_id"));
            const expiresAt = formData.get("expires_at")?.toString();

            if (!userId || !tagId) {
                return data({ success: false, message: "User and tag are required." }, { status: 400 });
            }

            const db = getDB(context);
            const existing = await db.selectFrom('user_tag_assignment')
                .select(['id'])
                .where('uid', '=', userId)
                .where('tag_id', '=', tagId)
                .executeTakeFirst();

            const parsedExpires = expiresAt && expiresAt.trim() !== "" ? new Date(expiresAt).toISOString() : null;

            if (existing && existing.id != null) {
                await db.updateTable('user_tag_assignment')
                    .set({
                        expires_at: parsedExpires,
                        assigned_by_uid: user.uid,
                    })
                    .where('id', '=', existing.id)
                    .execute();
                return data({ success: true, message: "Tag assignment updated." });
            } else {
                await db.insertInto('user_tag_assignment')
                    .values({
                        uid: userId,
                        tag_id: tagId,
                        expires_at: parsedExpires,
                        assigned_by_uid: user.uid,
                    })
                    .execute();
                return data({ success: true, message: "Tag assigned successfully." });
            }
        }
        case "remove_tag": {
            const assignmentId = Number(formData.get("assignment_id"));
            if (!assignmentId) {
                return data({ success: false, message: "Assignment ID is required." }, { status: 400 });
            }
            const db = getDB(context);
            await db.deleteFrom('user_tag_assignment')
                .where('id', '=', assignmentId)
                .execute();
            return data({ success: true, message: "Tag removed from user." });
        }
        case "update_tag_expiration": {
            const assignmentId = Number(formData.get("assignment_id"));
            const expiresAt = formData.get("expires_at")?.toString();
            if (!assignmentId) {
                return data({ success: false, message: "Assignment ID is required." }, { status: 400 });
            }
            const parsedExpires = expiresAt && expiresAt.trim() !== "" ? new Date(expiresAt).toISOString() : null;
            const db = getDB(context);
            await db.updateTable('user_tag_assignment')
                .set({
                    expires_at: parsedExpires,
                })
                .where('id', '=', assignmentId)
                .execute();
            return data({ success: true, message: "Tag expiration updated." });
        }
    }
    return redirect("/users");
};

export default function UsersIndex() {
    const { users, invites, tags, error } = useLoaderData<{
        users: UserWithTags[];
        invites: UserInvite[];
        tags: UserTag[];
        error?: string;
    }>();
    const actionData = useActionData<{ success?: boolean; message?: string }>();
    const submit = useSubmit();

    const [openedPopoverUid, setOpenedPopoverUid] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<string | null>("");

    // Tag management modal state
    const [tagModalUser, setTagModalUser] = useState<UserWithTags | null>(null);
    const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
    const [tagExpiresAt, setTagExpiresAt] = useState<string | null>(null);

    useErrorNotification(error);

    // Keep tagModalUser synced with latest users data
    useEffect(() => {
        if (tagModalUser) {
            const updated = users.find((u) => u.uid === tagModalUser.uid);
            if (updated) {
                setTagModalUser(updated);
            }
        }
    }, [users]);

    const togglePopover = (uid: string) => {
        setOpenedPopoverUid(prev => (prev === uid ? null : uid));
    };

    const closePopover = () => {
        setOpenedPopoverUid(null);
    };

    const handleRoleSave = (uid: string | undefined) => {
        const formData = new FormData();
        formData.append('action', 'set_role');
        formData.append('uid', uid ?? "");
        formData.append('role', selectedRole ?? "");
        submit(formData, { method: 'post' });
        closePopover();
    };

    const handleAssignTag = (e: React.FormEvent) => {
        e.preventDefault();
        if (!tagModalUser || !selectedTagId) return;
        const formData = new FormData();
        formData.append('action', 'assign_tag');
        formData.append('uid', tagModalUser.uid);
        formData.append('tag_id', selectedTagId);
        if (tagExpiresAt) {
            formData.append('expires_at', tagExpiresAt);
        }
        submit(formData, { method: 'post' });
        setSelectedTagId(null);
        setTagExpiresAt(null);
    };

    const handleRemoveTag = (assignmentId: number) => {
        const formData = new FormData();
        formData.append('action', 'remove_tag');
        formData.append('assignment_id', String(assignmentId));
        submit(formData, { method: 'post' });
    };

    const handleExtendTagOneYear = (assignmentId: number) => {
        const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const formData = new FormData();
        formData.append('action', 'update_tag_expiration');
        formData.append('assignment_id', String(assignmentId));
        formData.append('expires_at', oneYearLater);
        submit(formData, { method: 'post' });
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

    const renderActions = (record: UserWithTags) => (
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

            <Tooltip label="Assign Role">
                <Popover
                    width={200}
                    position="bottom"
                    withArrow
                    withinPortal
                    opened={openedPopoverUid === record.uid}
                    onClose={closePopover}
                    trapFocus
                >
                    <Popover.Target>
                        <ActionIcon
                            size="sm"
                            variant="transparent"
                            color="indigo"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (record.uid) {
                                    togglePopover(record.uid);
                                }
                            }}
                        >
                            <IconSquareKey size={16} />
                        </ActionIcon>
                    </Popover.Target>
                    <Popover.Dropdown onClick={(e) => e.preventDefault()}>
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
            </Tooltip>

            <Tooltip label="Manage Tags">
                <ActionIcon
                    size="sm"
                    variant="transparent"
                    color="teal"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTagModalUser(record as UserWithTags);
                        setSelectedTagId(null);
                        setTagExpiresAt(null);
                    }}
                >
                    <IconTag size={16} />
                </ActionIcon>
            </Tooltip>
        </Group>
    );

    return (
        <Container size="xl" p="md">
            <Stack>
                <Group justify="space-between" align="center">
                    <Title order={2}>Users</Title>
                    <Button
                        component={Link}
                        to="/admin/tags"
                        variant="light"
                        color="teal"
                        leftSection={<IconTags size={16} />}
                    >
                        Manage Tag Definitions
                    </Button>
                </Group>
                <DataTable<UserWithTags>
                    withTableBorder
                    borderRadius="sm"
                    withColumnBorders
                    striped
                    highlightOnHover
                    records={users}
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
                            accessor: "tags",
                            title: "Tags",
                            render: (record: UserWithTags) => {
                                const userTags = record.tags || [];
                                if (userTags.length === 0) {
                                    return <Text size="xs" c="dimmed">No tags</Text>;
                                }
                                return (
                                    <Group gap={4} wrap="wrap">
                                        {userTags.map((t) => (
                                            <Tooltip
                                                key={t.assignmentId}
                                                label={
                                                    t.isExpired
                                                        ? `Expired on ${t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'unknown'}`
                                                        : t.expiresAt
                                                        ? `Expires: ${new Date(t.expiresAt).toLocaleDateString()}`
                                                        : 'No expiration'
                                                }
                                            >
                                                <Badge
                                                    size="sm"
                                                    color={t.isExpired ? 'gray' : (t.color || 'blue')}
                                                    variant={t.isExpired ? 'outline' : 'filled'}
                                                    styles={t.isExpired ? { root: { textDecoration: 'line-through', opacity: 0.7 } } : undefined}
                                                >
                                                    {t.name}
                                                </Badge>
                                            </Tooltip>
                                        ))}
                                    </Group>
                                );
                            },
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
                        <MultiSelect
                            name="invite_tags"
                            label="Pre-assigned Tags (optional)"
                            description="Users will automatically receive these tags upon their first login"
                            data={tags.map((t) => ({ value: String(t.id), label: t.name }))}
                            searchable
                            clearable
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
                                    {invite.tags && invite.tags.map((t) => (
                                        <Badge key={t.id} color={t.color || 'blue'}>
                                            {t.name}
                                        </Badge>
                                    ))}
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

            {/* Manage User Tags Modal */}
            <Modal
                opened={!!tagModalUser}
                onClose={() => setTagModalUser(null)}
                title={
                    <Group gap="xs">
                        <IconTag size={20} color="teal" />
                        <Text fw={600} size="lg">
                            Manage Tags: {tagModalUser?.displayName || tagModalUser?.email || "User"}
                        </Text>
                    </Group>
                }
                size="lg"
                centered
            >
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        Assign, refresh, or remove donor and subscription tiers for this user.
                    </Text>

                    <Title order={5}>Current Tags</Title>
                    {(!tagModalUser?.tags || tagModalUser.tags.length === 0) ? (
                        <Text size="sm" c="dimmed">No tags currently assigned to this user.</Text>
                    ) : (
                        <Stack gap="xs">
                            {tagModalUser.tags.map((t) => (
                                <Card key={t.assignmentId} withBorder p="xs" radius="sm">
                                    <Group justify="space-between" wrap="nowrap">
                                        <Group gap="xs">
                                            <Badge
                                                color={t.isExpired ? "gray" : (t.color || "blue")}
                                                variant={t.isExpired ? "outline" : "filled"}
                                                styles={t.isExpired ? { root: { textDecoration: "line-through", opacity: 0.7 } } : undefined}
                                            >
                                                {t.name}
                                            </Badge>
                                            {t.isExpired ? (
                                                <Badge color="red" variant="light" size="xs">
                                                    Expired ({t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : ""})
                                                </Badge>
                                            ) : t.expiresAt ? (
                                                <Text size="xs" c="dimmed">
                                                    Expires: {new Date(t.expiresAt).toLocaleDateString()}
                                                </Text>
                                            ) : (
                                                <Text size="xs" c="dimmed">
                                                    No expiration
                                                </Text>
                                            )}
                                        </Group>
                                        <Group gap={6}>
                                            <Button
                                                size="compact-xs"
                                                variant="light"
                                                color="blue"
                                                leftSection={<IconRefresh size={12} />}
                                                onClick={() => handleExtendTagOneYear(t.assignmentId)}
                                                title="Extend expiration by 1 year from now"
                                            >
                                                +1 Year
                                            </Button>
                                            <ActionIcon
                                                size="sm"
                                                variant="subtle"
                                                color="red"
                                                onClick={() => handleRemoveTag(t.assignmentId)}
                                                title="Remove Tag"
                                            >
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </Group>
                                    </Group>
                                </Card>
                            ))}
                        </Stack>
                    )}

                    <Divider my="xs" />

                    <Title order={5}>Assign or Refresh Tag</Title>
                    <form onSubmit={handleAssignTag}>
                        <Stack gap="sm">
                            <Select
                                label="Select Tag"
                                placeholder="Choose a tag..."
                                data={tags.map(t => ({ value: String(t.id), label: t.name }))}
                                value={selectedTagId}
                                onChange={setSelectedTagId}
                                required
                            />
                            <DateInput
                                label="Expiration Date (optional)"
                                description="Leave empty if tag should never expire"
                                placeholder="Select expiration date"
                                clearable
                                value={tagExpiresAt}
                                onChange={(val) => setTagExpiresAt(val)}
                            />
                            <Group gap="xs">
                                <Text size="xs" c="dimmed">Quick presets:</Text>
                                <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    onClick={() => setTagExpiresAt(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))}
                                >
                                    +1 Month
                                </Button>
                                <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    onClick={() => setTagExpiresAt(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))}
                                >
                                    +1 Year
                                </Button>
                                <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="gray"
                                    onClick={() => setTagExpiresAt(null)}
                                >
                                    Never
                                </Button>
                            </Group>
                            <Group justify="flex-end" mt="xs">
                                <Button
                                    type="submit"
                                    disabled={!selectedTagId}
                                    leftSection={<IconPlus size={16} />}
                                >
                                    Assign Tag
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Stack>
            </Modal>
        </Container>
    );
}
