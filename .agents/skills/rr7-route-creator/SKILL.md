---
name: rr7-route-creator
description: >-
  Use this skill when adding or refactoring React Router v7 routes, loaders, actions,
  error boundaries, or integrating Mantine v9 UI components in this repository.
---

# React Router v7 Route Creator

This guide provides boilerplate and established patterns for scaffolding React Router v7 routes with SingleFetch mode and Mantine v9 in this repository.

---

## 1. File Placement & Routing
- Place route modules in [app/routes/](file:///x:/Documents/GitHub/demofinder/app/routes).
- React Router v7 uses file-system routing. For example:
  - `app/routes/crags._index.tsx` -> `/crags`
  - `app/routes/crags.$id.tsx` -> `/crags/:id`
  - `app/routes/api.v1.example.ts` -> `/api/v1/example` (Resource route)

---

## 2. Standard UI Route Boilerplate

```tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useActionData, Form, Link } from "react-router";
import { Container, Title, Text, Stack, Button, Paper, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { getDB } from "~/lib/db";
import { requireUser } from "~/lib/auth.server";

// 1. Loader (SingleFetch: return raw plain object or data())
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  const db = getDB(context);

  const items = await db.selectFrom("issue").selectAll().limit(20).execute();

  return { items, user };
}

// 2. Action (Handling form submissions)
export async function action({ request, context, params }: ActionFunctionArgs) {
  const user = await requireUser(request, context);
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();

  if (!title) {
    return data({ error: "Title is required" }, { status: 400 });
  }

  // Perform database update...
  return { success: true };
}

// 3. UI Component (Mantine v9)
export default function MyPageRoute() {
  const { items, user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Title order={1}>Page Title</Title>
        <Text c="dimmed">Welcome, {user.displayName}</Text>

        {actionData?.error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {actionData.error}
          </Alert>
        )}

        <Paper withBorder p="md" radius="sm">
          <Form method="post">
            <Stack gap="sm">
              <Button type="submit">Submit</Button>
            </Stack>
          </Form>
        </Paper>
      </Stack>
    </Container>
  );
}

// 4. Error Boundary
export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <Container size="sm" py="xl">
      <Alert color="red" title="Error Loading Page">
        An unexpected error occurred while loading this page.
      </Alert>
    </Container>
  );
}
```

---

## 3. Resource Route Boilerplate (JSON API)

For API endpoints (e.g. `app/routes/api.v1.*.ts`), do not export a default component:

```ts
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDB } from "~/lib/db";
import { requireApiTokenUser } from "~/lib/apiAuth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireApiTokenUser(request, context);
  const db = getDB(context);

  const results = await db.selectFrom("crag").selectAll().execute();

  // Return raw object for 200, or data(..., { status }) for errors
  return { results };
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "method_not_allowed" }, { status: 405 });
  }

  const payload = await request.json();
  // Process action...
  return data({ status: "created" }, { status: 201 });
}
```
