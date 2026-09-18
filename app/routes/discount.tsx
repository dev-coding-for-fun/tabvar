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
  useActionData,
  useLoaderData,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getDB } from "~/lib/db";
import {
  claimDiscountCode,
  getUserDiscountCode,
  isUserEligibleForDiscount,
} from "~/lib/discounts.server";
import type { User } from "~/lib/models";
import { privatePageMeta } from "~/lib/seo";

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

  // 4. If site admin, load pool statistics, assignments, and unassigned codes
  let adminStats: AdminDiscountStats | null = null;
  if (user.role === "admin") {
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
  if (user.role !== "admin") {
    return data({ error: "Only site admins can manage discount codes." }, { status: 403 });
  }

  const { request, context } = args;
  const formData = await request.formData();
  const formAction = formData.get("action");
  const db = getDB(context);

  switch (formAction) {
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
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
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

        {/* Admin Management Section */}
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
                  Admin Section
                </Badge>
              </Group>

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
