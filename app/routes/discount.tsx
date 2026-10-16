import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Collapse,
  Container,
  Divider,
  Group,
  Image,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconExternalLink,
  IconGift,
  IconShield,
  IconTrash,
  IconUserMinus,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getDB } from "~/lib/db";
import { sql } from "kysely";
import {
  canManageDiscounts,
  claimDiscountCode,
  DEFAULT_DISCOUNT_TAG,
  getUserDiscountCode,
  isUserEligibleForDiscount,
} from "~/lib/discounts.server";
import type { User } from "~/lib/models";
import { privatePageMeta } from "~/lib/seo";
import { addInviteTags, assignUserTag, userHasActiveTag } from "~/lib/tags.server";

export const meta: MetaFunction = () => privatePageMeta("Exclusive Discount QR Code");

export interface AdminDiscountAssignment {
  id: number;
  codeKey: string;
  claimedEmail: string;
  claimedUid: string | null;
  claimedAt: string | null;
}

export interface AdminUnassignedCode {
  id: number;
  codeKey: string;
  createdAt: string | null;
}

export interface AdminDiscountStats {
  total: number;
  claimedCount: number;
  unclaimedCount: number;
  assignments: AdminDiscountAssignment[];
  unassignedPool: AdminUnassignedCode[];
}

export async function loader(args: LoaderFunctionArgs) {
  const user: User = await requireUser(args);
  const db = getDB(args.context);

  // 1. Check if user already has an assigned code
  let code = await getUserDiscountCode(db, user.email, user.uid);
  let eligible = false;
  let exhausted = false;

  if (!code) {
    // 2. Check if user is eligible via user tag
    eligible = await isUserEligibleForDiscount(db, user.uid);

    if (eligible && user.email) {
      // 3. Automatically claim an available code
      code = await claimDiscountCode(db, user.email, user.uid);
      if (!code) {
        exhausted = true;
      }
    }
  } else {
    eligible = true;
  }

  // 4. Load management data for admins and active program managers.
  let adminStats: AdminDiscountStats | null = null;
  if (await canManageDiscounts(db, user)) {
    const allCodes = await db
      .selectFrom("user_discount_code")
      .select([
        "id",
        "code_key as codeKey",
        "claimed_email as claimedEmail",
        "claimed_uid as claimedUid",
        "claimed_at as claimedAt",
        "created_at as createdAt",
      ])
      .orderBy("claimed_at", "desc")
      .execute();

    const total = allCodes.length;
    const claimedCodes = allCodes.filter((c) => Boolean(c.claimedEmail));
    const unclaimedCodes = allCodes.filter((c) => !c.claimedEmail);
    const claimedCount = claimedCodes.length;
    const unclaimedCount = total - claimedCount;

    adminStats = {
      total,
      claimedCount,
      unclaimedCount,
      assignments: claimedCodes.map((c) => ({
        id: Number(c.id),
        codeKey: c.codeKey,
        claimedEmail: c.claimedEmail!,
        claimedUid: c.claimedUid,
        claimedAt: c.claimedAt,
      })),
      unassignedPool: unclaimedCodes.map((c) => ({
        id: Number(c.id),
        codeKey: c.codeKey,
        createdAt: c.createdAt,
      })),
    };
  }

  return {
    user,
    code,
    eligible,
    exhausted,
    adminStats,
  };
}

export async function action(args: ActionFunctionArgs) {
  const user: User = await requireUser(args);
  const db = getDB(args.context);
  if (!(await canManageDiscounts(db, user))) {
    return data({ error: "Only site admins and supporter program managers can manage discounts." }, { status: 403 });
  }

  const { request, context } = args;
  const formData = await request.formData();
  const formAction = formData.get("action");

  switch (formAction) {
    case "add_supporter": {
      const rawEmail = formData.get("email");
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return data({ error: "Enter a valid email address." }, { status: 400 });
      }

      try {
        const tag = await db.selectFrom("user_tag")
          .select("id")
          .where("name", "=", DEFAULT_DISCOUNT_TAG)
          .executeTakeFirst();
        if (tag?.id == null) {
          return data({ error: "The super supporter tag is missing. Ask a site admin to restore it." }, { status: 500 });
        }

        const target = await db.selectFrom("user")
          .select("uid")
          .where(sql<string>`email COLLATE NOCASE`, "=", email)
          .executeTakeFirst();
        if (target) {
          if (await userHasActiveTag(db, target.uid, DEFAULT_DISCOUNT_TAG)) {
            return { info: true, message: `${email} already has the super supporter tag.` };
          }
          await assignUserTag(db, { uid: target.uid, tagId: tag.id, assignedByUid: user.uid });
          return { success: true, message: `Super supporter tag added to ${email}.` };
        }

        const invite = await db.selectFrom("user_invite")
          .select("email")
          .where("email", "=", email)
          .executeTakeFirst();
        if (invite) {
          const existingTag = await db.selectFrom("user_invite_tag")
            .select(["id", "expires_at as expiresAt"])
            .where("email", "=", email)
            .where("tag_id", "=", tag.id)
            .executeTakeFirst();
          if (existingTag) {
            if (!existingTag.expiresAt || new Date(existingTag.expiresAt) > new Date()) {
              return { info: true, message: `The invite for ${email} already has the super supporter tag.` };
            }
            await db.updateTable("user_invite_tag")
              .set({ expires_at: null })
              .where("id", "=", existingTag.id)
              .execute();
          } else {
            await addInviteTags(db, email, [tag.id]);
          }
          return { success: true, message: `Super supporter tag added to the existing invite for ${email}.` };
        }

        await db.insertInto("user_invite")
          .values({
            email,
            display_name: null,
            role: "member",
            invited_by_uid: user.uid,
            invited_by_name: user.displayName ?? "",
            token_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .execute();
        await addInviteTags(db, email, [tag.id]);
        return { success: true, message: `Member invite created for ${email} with the super supporter tag.` };
      } catch (error) {
        console.error("Failed to add super supporter tag:", error);
        return data({ error: "Could not add the super supporter tag. Please retry; any existing user or invite will be reused." }, { status: 500 });
      }
    }

    case "unassign_code": {
      const codeId = Number(formData.get("code_id"));
      if (!codeId) {
        return data({ error: "Code ID is required." }, { status: 400 });
      }

      await db
        .updateTable("user_discount_code")
        .set({
          claimed_email: null,
          claimed_uid: null,
          claimed_at: null,
        })
        .where("id", "=", codeId)
        .execute();

      return { success: true, message: "Code unassigned and returned to available pool." };
    }

    case "delete_code": {
      const codeId = Number(formData.get("code_id"));
      if (!codeId) {
        return data({ error: "Code ID is required." }, { status: 400 });
      }

      const existing = await db
        .selectFrom("user_discount_code")
        .select(["id", "code_key as codeKey", "claimed_email as claimedEmail"])
        .where("id", "=", codeId)
        .executeTakeFirst();

      if (!existing) {
        return data({ error: "Code not found." }, { status: 404 });
      }

      if (existing.claimedEmail) {
        return data(
          { error: "Cannot delete an assigned code. Please unassign it first." },
          { status: 400 }
        );
      }

      // Delete from DB
      await db
        .deleteFrom("user_discount_code")
        .where("id", "=", codeId)
        .execute();

      // Delete from R2 storage
      try {
        const bucket = context.cloudflare.env.TABVAR_MISC;
        if (bucket) {
          await bucket.delete(existing.codeKey);
        }
      } catch (err) {
        console.warn("Failed to delete object from R2:", err);
      }

      return { success: true, message: "Unassigned code deleted from database and storage." };
    }

    default:
      return data({ error: "Unknown action." }, { status: 400 });
  }
}

export default function DiscountPage() {
  const { user, code, eligible, exhausted, adminStats } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; info?: boolean; message?: string; error?: string }>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [unassignTarget, setUnassignTarget] = useState<{ id: number; email: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; codeKey: string } | null>(null);
  const [showUnassignedPool, setShowUnassignedPool] = useState(false);

  useEffect(() => {
    if (actionData?.success && actionData?.message) {
      showNotification({
        title: "Success",
        message: actionData.message,
        color: "green",
      });
      setUnassignTarget(null);
      setDeleteTarget(null);
    } else if (actionData?.info && actionData?.message) {
      showNotification({ title: "Already added", message: actionData.message, color: "blue" });
    } else if (actionData?.error) {
      showNotification({
        title: "Error",
        message: actionData.error,
        color: "red",
      });
    }
  }, [actionData]);

  const handleConfirmUnassign = () => {
    if (!unassignTarget) return;
    const formData = new FormData();
    formData.append("action", "unassign_code");
    formData.append("code_id", String(unassignTarget.id));
    submit(formData, { method: "post" });
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.append("action", "delete_code");
    formData.append("code_id", String(deleteTarget.id));
    submit(formData, { method: "post" });
  };

  return (
    <Container size={adminStats ? "md" : "sm"} py="xl">
      <Stack gap="xl">
        {/* User Discount Card Section */}
        <Stack gap="lg">
          <div>
            <Group justify="space-between" align="center" mb="xs">
              <Group gap="xs">
                <IconGift size={28} color="#228be6" />
                <Title order={2}>Exclusive Member Discount</Title>
              </Group>
              {code && <Badge color="green" variant="light">Active</Badge>}
            </Group>
            <Text c="dimmed" size="sm">
              Thank you for being part of the TABVAR community.
            </Text>
          </div>

          {code ? (
            <Card withBorder shadow="sm" radius="md" p="xl">
              <Stack align="center" gap="md">
                <Badge size="lg" color="blue" variant="filled">
                  Single-Use QR Code
                </Badge>

                <Paper
                  withBorder
                  p="md"
                  radius="md"
                  bg="white"
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    maxWidth: 340,
                    width: "100%",
                  }}
                >
                  <Image
                    src={`/api/discounts/${encodeURIComponent(code.codeKey)}`}
                    alt="Your Discount QR Code"
                    fit="contain"
                    style={{ maxHeight: 300, width: "auto" }}
                  />
                </Paper>

                <Alert
                  icon={<IconCheck size={18} />}
                  color="teal"
                  variant="light"
                  style={{ width: "100%" }}
                >
                  <Text size="sm" fw={500}>
                    Ready to redeem at the counter
                  </Text>
                  <Text size="xs" c="dimmed">
                    Present this QR code to the cashier to apply your discount. 20% off code is valid for retail items only. Can only be used once. Expires May 31, 2027. Does not stack with other sales or member discounts.
                  </Text>
                </Alert>

                <Button
                  component="a"
                  href={`/api/discounts/${encodeURIComponent(code.codeKey)}?download=1&filename=${encodeURIComponent(`tabvar-discount-${user.displayName || "code"}.${code.codeKey.split(".").pop() || "png"}`)}`}
                  download={`tabvar-discount-${user.displayName || "code"}.${code.codeKey.split(".").pop() || "png"}`}
                  leftSection={<IconDownload size={18} />}
                  variant="light"
                  color="blue"
                  fullWidth
                >
                  Save / Download QR Code
                </Button>
              </Stack>
            </Card>
          ) : exhausted ? (
            <Alert
              icon={<IconAlertCircle size={20} />}
              title="Promotion Fully Claimed"
              color="yellow"
              variant="filled"
            >
              All available promotional discount codes for this round have been claimed. Thank you for your support!
            </Alert>
          ) : !eligible ? (
            <Alert
              icon={<IconAlertCircle size={20} />}
              title="Promotion Unavailable"
              color="blue"
              variant="light"
            >
              This discount promotion is reserved for designated tagged members. If you believe you should have access, please reach out to the TABVAR team.
            </Alert>
          ) : null}
        </Stack>

        {/* Discount Management Section */}
        {adminStats && (
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <IconShield size={24} color="var(--mantine-color-violet-6)" />
                  <div>
                    <Title order={3}>Manage Discounts</Title>
                    <Text size="xs" c="dimmed">
                      Overview of remaining pool and current member assignments
                    </Text>
                  </div>
                </Group>
                <Badge color="violet" variant="light" size="sm">
                  Management
                </Badge>
              </Group>

              <Paper withBorder p="md" radius="sm">
                <Form method="post">
                  <input type="hidden" name="action" value="add_supporter" />
                  <Stack gap="sm">
                    <Title order={4}>Add a super supporter</Title>
                    <Text size="sm" c="dimmed">
                      Add discount eligibility to a user or invite. If neither exists, a member invite is created and the tag is applied when they sign in.
                    </Text>
                    <TextInput name="email" type="email" label="Email address" placeholder="supporter@example.com" required />
                    <Button type="submit" loading={navigation.state !== "idle" && navigation.formData?.get("action") === "add_supporter"}>
                      Add super supporter
                    </Button>
                  </Stack>
                </Form>
              </Paper>

              {/* Pool Metrics */}
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <Paper withBorder p="md" radius="sm">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Total Pool
                  </Text>
                  <Text size="xl" fw={700}>
                    {adminStats.total}
                  </Text>
                </Paper>
                <Paper withBorder p="md" radius="sm">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Claimed Codes
                  </Text>
                  <Text size="xl" fw={700} c="blue">
                    {adminStats.claimedCount}
                  </Text>
                </Paper>
                <Paper withBorder p="md" radius="sm">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Available Remaining
                  </Text>
                  <Text
                    size="xl"
                    fw={700}
                    c={adminStats.unclaimedCount > 0 ? "teal" : "red"}
                  >
                    {adminStats.unclaimedCount}
                  </Text>
                </Paper>
              </SimpleGrid>

              {/* Utilization Progress Bar */}
              <Stack gap={6}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Pool Claim Rate
                  </Text>
                  <Text size="xs" fw={600}>
                    {adminStats.total > 0
                      ? Math.round((adminStats.claimedCount / adminStats.total) * 100)
                      : 0}
                    %
                  </Text>
                </Group>
                <Progress
                  value={
                    adminStats.total > 0
                      ? (adminStats.claimedCount / adminStats.total) * 100
                      : 0
                  }
                  color="blue"
                  size="sm"
                  radius="xl"
                />
              </Stack>

              <Divider my="xs" />

              {/* Claimed Assignments Table */}
              <Group justify="space-between" align="center">
                <Title order={4}>
                  Current Assignments ({adminStats.assignments.length})
                </Title>
              </Group>

              {adminStats.assignments.length === 0 ? (
                <Text size="sm" c="dimmed" fs="italic">
                  No discount codes have been assigned yet.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={500}>
                  <Table striped highlightOnHover verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>User Email</Table.Th>
                        <Table.Th>Claimed Date</Table.Th>
                        <Table.Th style={{ textAlign: "right" }}>Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {adminStats.assignments.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {item.claimedEmail}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {item.claimedAt
                                ? new Date(item.claimedAt).toLocaleString()
                                : "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td style={{ textAlign: "right" }}>
                            <Group gap={8} justify="flex-end" wrap="nowrap">
                              <Anchor
                                href={`/api/discounts/${encodeURIComponent(item.codeKey)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                size="xs"
                              >
                                <Group gap={4}>
                                  <span>View QR</span>
                                  <IconExternalLink size={12} />
                                </Group>
                              </Anchor>
                              <Tooltip label="Unassign code (return to pool)">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="orange"
                                  onClick={() =>
                                    setUnassignTarget({
                                      id: item.id,
                                      email: item.claimedEmail,
                                    })
                                  }
                                >
                                  <IconUserMinus size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}

              <Divider my="xs" />

              {/* Unassigned Pool Section */}
              <Group justify="space-between" align="center">
                <div>
                  <Title order={4}>
                    Remaining Unassigned Pool ({adminStats.unassignedPool.length})
                  </Title>
                  <Text size="xs" c="dimmed">
                    Codes waiting in the pool to be claimed by eligible members
                  </Text>
                </div>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  rightSection={
                    showUnassignedPool ? (
                      <IconChevronUp size={14} />
                    ) : (
                      <IconChevronDown size={14} />
                    )
                  }
                  onClick={() => setShowUnassignedPool((prev) => !prev)}
                >
                  {showUnassignedPool ? "Hide Pool" : "View Pool"}
                </Button>
              </Group>

              <Collapse expanded={showUnassignedPool}>
                {adminStats.unassignedPool.length === 0 ? (
                  <Text size="sm" c="dimmed" fs="italic">
                    No unassigned codes remain in the pool.
                  </Text>
                ) : (
                  <Table.ScrollContainer minWidth={500}>
                    <Table striped highlightOnHover verticalSpacing="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Code Key</Table.Th>
                          <Table.Th>Seeded Date</Table.Th>
                          <Table.Th style={{ textAlign: "right" }}>Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {adminStats.unassignedPool.map((item) => (
                          <Table.Tr key={item.id}>
                            <Table.Td>
                              <Text size="xs" ff="monospace">
                                {item.codeKey}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="xs" c="dimmed">
                                {item.createdAt
                                  ? new Date(item.createdAt).toLocaleString()
                                  : "—"}
                              </Text>
                            </Table.Td>
                            <Table.Td style={{ textAlign: "right" }}>
                              <Group gap={8} justify="flex-end" wrap="nowrap">
                                <Anchor
                                  href={`/api/discounts/${encodeURIComponent(item.codeKey)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="xs"
                                >
                                  <Group gap={4}>
                                    <span>View QR</span>
                                    <IconExternalLink size={12} />
                                  </Group>
                                </Anchor>
                                <Tooltip label="Delete unassigned code from pool and storage">
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color="red"
                                    onClick={() =>
                                      setDeleteTarget({
                                        id: item.id,
                                        codeKey: item.codeKey,
                                      })
                                    }
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Collapse>
            </Stack>
          </Card>
        )}
      </Stack>

      {/* Unassign Confirmation Modal */}
      <Modal
        opened={unassignTarget !== null}
        onClose={() => setUnassignTarget(null)}
        title="Confirm Unassignment"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to unassign the discount code from{" "}
            <strong>{unassignTarget?.email}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            This code will immediately return to the available pool and can be claimed by another
            eligible member.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setUnassignTarget(null)}>
              Cancel
            </Button>
            <Button color="orange" onClick={handleConfirmUnassign}>
              Unassign Code
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Deletion"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to permanently delete unassigned code{" "}
            <strong>{deleteTarget?.codeKey}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            This code will be removed from the database and its image deleted from R2 storage. This
            action cannot be undone.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmDelete}>
              Delete Code
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
