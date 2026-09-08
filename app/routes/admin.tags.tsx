import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconEdit,
  IconPlus,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useErrorNotification } from "~/components/useErrorNotification";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { getDB } from "~/lib/db";
import type { User } from "~/lib/models";
import { privatePageMeta } from "~/lib/seo";
import { getAllTags, type TagWithUsageCount } from "~/lib/tags.server";

export const COLOR_OPTIONS = [
  { value: "blue", label: "Blue" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
  { value: "grape", label: "Grape" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "pink", label: "Pink" },
  { value: "red", label: "Red" },
  { value: "gray", label: "Gray" },
];

export const loader = async (args: LoaderFunctionArgs) => {
  const user: User = await requireUser(args);
  if (user.role !== "admin") {
    return data({ tags: [], error: PERMISSION_ERROR }, { status: 403 });
  }
  const db = getDB(args.context);
  const tags = await getAllTags(db);
  return { tags };
};

export const meta: MetaFunction<typeof loader> = () => privatePageMeta("User Tags");

export const action = async (args: ActionFunctionArgs) => {
  const user: User = await requireUser(args);
  if (user.role !== "admin") {
    return data({ error: PERMISSION_ERROR }, { status: 403 });
  }

  const { request, context } = args;
  const formData = await request.formData();
  const formAction = formData.get("action");
  const db = getDB(context);

  switch (formAction) {
    case "create_tag": {
      const name = formData.get("name")?.toString().trim();
      const description = formData.get("description")?.toString().trim() || null;
      const color = formData.get("color")?.toString().trim() || "blue";

      if (!name) {
        return data(
          { success: false, message: "Tag name is required." },
          { status: 400 }
        );
      }

      try {
        await db
          .insertInto("user_tag")
          .values({
            name,
            description,
            color,
          })
          .execute();
        return { success: true, message: `Tag "${name}" created successfully.` };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes("UNIQUE constraint failed")) {
          return data(
            { success: false, message: `A tag with name "${name}" already exists.` },
            { status: 400 }
          );
        }
        return data(
          { success: false, message: "Failed to create tag." },
          { status: 500 }
        );
      }
    }

    case "update_tag": {
      const tagId = Number(formData.get("tag_id"));
      const name = formData.get("name")?.toString().trim();
      const description = formData.get("description")?.toString().trim() || null;
      const color = formData.get("color")?.toString().trim() || "blue";

      if (!tagId || !name) {
        return data(
          { success: false, message: "Tag ID and name are required." },
          { status: 400 }
        );
      }

      try {
        await db
          .updateTable("user_tag")
          .set({
            name,
            description,
            color,
          })
          .where("id", "=", tagId)
          .execute();
        return { success: true, message: `Tag "${name}" updated successfully.` };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes("UNIQUE constraint failed")) {
          return data(
            { success: false, message: `A tag with name "${name}" already exists.` },
            { status: 400 }
          );
        }
        return data(
          { success: false, message: "Failed to update tag." },
          { status: 500 }
        );
      }
    }

    case "delete_tag": {
      const tagId = Number(formData.get("tag_id"));
      if (!tagId) {
        return data(
          { success: false, message: "Tag ID is required." },
          { status: 400 }
        );
      }

      try {
        await db.deleteFrom("user_tag").where("id", "=", tagId).execute();
        return { success: true, message: "Tag deleted successfully." };
      } catch (err) {
        return data(
          { success: false, message: "Failed to delete tag." },
          { status: 500 }
        );
      }
    }

    default:
      return data({ success: false, message: "Unknown action." }, { status: 400 });
  }
};

export default function AdminTags() {
  const { tags, error } = useLoaderData<{
    tags: TagWithUsageCount[];
    error?: string;
  }>();
  const actionData = useActionData<{ success?: boolean; message?: string }>();
  const submit = useSubmit();

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editTag, setEditTag] = useState<TagWithUsageCount | null>(null);
  const [deleteTag, setDeleteTag] = useState<TagWithUsageCount | null>(null);

  // Form states for create
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createColor, setCreateColor] = useState<string | null>("blue");

  // Form states for edit
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState<string | null>("blue");

  useErrorNotification(error);

  useEffect(() => {
    if (actionData?.success) {
      showNotification({
        title: "Success",
        message: actionData.message,
        color: "green",
        autoClose: 3000,
      });
      closeCreate();
      setEditTag(null);
      setDeleteTag(null);
      setCreateName("");
      setCreateDescription("");
      setCreateColor("blue");
    } else if (actionData && actionData.success === false) {
      showNotification({
        title: "Error",
        message: actionData.message,
        color: "red",
        icon: <IconX />,
        autoClose: 3000,
      });
    }
  }, [actionData, closeCreate]);

  const handleOpenEdit = (tag: TagWithUsageCount) => {
    setEditTag(tag);
    setEditName(tag.name);
    setEditDescription(tag.description || "");
    setEditColor(tag.color || "blue");
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("action", "create_tag");
    formData.append("name", createName);
    formData.append("description", createDescription);
    formData.append("color", createColor || "blue");
    submit(formData, { method: "post" });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTag) return;
    const formData = new FormData();
    formData.append("action", "update_tag");
    formData.append("tag_id", String(editTag.id));
    formData.append("name", editName);
    formData.append("description", editDescription);
    formData.append("color", editColor || "blue");
    submit(formData, { method: "post" });
  };

  const handleDeleteSubmit = () => {
    if (!deleteTag) return;
    const formData = new FormData();
    formData.append("action", "delete_tag");
    formData.append("tag_id", String(deleteTag.id));
    submit(formData, { method: "post" });
  };

  const renderActions: DataTableColumn<TagWithUsageCount>["render"] = (record) => (
    <Group gap={6} wrap="nowrap">
      <ActionIcon
        size="sm"
        variant="subtle"
        color="blue"
        onClick={() => handleOpenEdit(record)}
        title="Edit Tag"
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="red"
        onClick={() => setDeleteTag(record)}
        title="Delete Tag"
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );

  return (
    <Container size="xl" p="md">
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Button
              component={Link}
              to="/users"
              variant="subtle"
              leftSection={<IconArrowLeft size={16} />}
            >
              Back to Users
            </Button>
            <Title order={2}>Tag Management</Title>
          </Group>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={openCreate}
          >
            Create Tag
          </Button>
        </Group>

        <Text c="dimmed" size="sm">
          Define tags and donor/subscription tiers that can be assigned to users.
          Tags support optional expiration dates and can be manually granted or refreshed in User Management.
        </Text>

        <DataTable
          withTableBorder
          borderRadius="sm"
          withColumnBorders
          striped
          highlightOnHover
          records={tags}
          columns={[
            {
              accessor: "name",
              title: "Tag",
              render: (record) => (
                <Group gap="xs">
                  <Badge color={record.color || "blue"} variant="filled" size="md">
                    {record.name}
                  </Badge>
                </Group>
              ),
            },
            {
              accessor: "description",
              title: "Description",
              render: (record) => (
                <Text size="sm">{record.description || "—"}</Text>
              ),
            },
            {
              accessor: "color",
              title: "Badge Color",
              width: 140,
              render: (record) => (
                <Badge color={record.color || "blue"} variant="light" size="sm">
                  {record.color || "blue"}
                </Badge>
              ),
            },
            {
              accessor: "activeCount",
              title: "Active Users",
              width: 130,
              render: (record) => (
                <Badge variant="outline" color={record.activeCount > 0 ? "green" : "gray"}>
                  {record.activeCount} active
                </Badge>
              ),
            },
            {
              accessor: "createdAt",
              title: "Created",
              width: 150,
              render: (record) =>
                record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "—",
            },
            {
              accessor: "actions",
              title: "Actions",
              width: 90,
              render: renderActions,
            },
          ]}
          noRecordsText="No tags defined yet. Click 'Create Tag' to add one."
        />
      </Stack>

      {/* Create Tag Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title={<Text fw={600} size="lg">Create New Tag</Text>}
        centered
      >
        <form onSubmit={handleCreateSubmit}>
          <Stack gap="md">
            <TextInput
              label="Tag Name"
              placeholder="e.g. Supporter, Super Supporter, Beta Tester"
              required
              value={createName}
              onChange={(e) => setCreateName(e.currentTarget.value)}
            />
            <Textarea
              label="Description (optional)"
              placeholder="e.g. Annual donor contributing $50+ to tabvar"
              rows={3}
              value={createDescription}
              onChange={(e) => setCreateDescription(e.currentTarget.value)}
            />
            <Select
              label="Badge Color"
              data={COLOR_OPTIONS}
              value={createColor}
              onChange={setCreateColor}
            />
            <Group justify="space-between" mt="xs">
              <Text size="xs" c="dimmed">
                Preview:
              </Text>
              <Badge color={createColor || "blue"} variant="filled">
                {createName || "Tag Preview"}
              </Badge>
            </Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={closeCreate}>
                Cancel
              </Button>
              <Button type="submit" leftSection={<IconTag size={16} />}>
                Create Tag
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Edit Tag Modal */}
      <Modal
        opened={!!editTag}
        onClose={() => setEditTag(null)}
        title={<Text fw={600} size="lg">Edit Tag: {editTag?.name}</Text>}
        centered
      >
        <form onSubmit={handleEditSubmit}>
          <Stack gap="md">
            <TextInput
              label="Tag Name"
              required
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
            />
            <Textarea
              label="Description (optional)"
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.currentTarget.value)}
            />
            <Select
              label="Badge Color"
              data={COLOR_OPTIONS}
              value={editColor}
              onChange={setEditColor}
            />
            <Group justify="space-between" mt="xs">
              <Text size="xs" c="dimmed">
                Preview:
              </Text>
              <Badge color={editColor || "blue"} variant="filled">
                {editName || "Tag Preview"}
              </Badge>
            </Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setEditTag(null)}>
                Cancel
              </Button>
              <Button type="submit">
                Save Changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={!!deleteTag}
        onClose={() => setDeleteTag(null)}
        title={<Text fw={600} c="red" size="lg">Delete Tag</Text>}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to delete the tag <strong>{deleteTag?.name}</strong>?
          </Text>
          {deleteTag && deleteTag.activeCount > 0 && (
            <Card bg="red.0" withBorder p="sm">
              <Text size="xs" c="red.9" fw={500}>
                Warning: This tag is currently assigned to {deleteTag.activeCount} user(s).
                Deleting it will remove the tag from all assigned users.
              </Text>
            </Card>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setDeleteTag(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDeleteSubmit}>
              Delete Tag
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
