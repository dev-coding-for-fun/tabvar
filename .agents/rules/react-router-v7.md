# React Router v7 SingleFetch Invariant Rules

This repository runs **React Router v7** with `SingleFetch` mode enabled (`ssr: true` in `react-router.config.ts`). All agents writing or refactoring routes, loaders, actions, and UI components must follow these rules.

---

## 1. Import Rules
- **NEVER** import from `@remix-run/*`. The codebase has fully migrated to React Router v7.
- **ALWAYS** import routing utilities from `react-router`:
  ```ts
  import {
    data,
    useLoaderData,
    useActionData,
    useFetcher,
    useSubmit,
    Form,
    Link,
    isRouteErrorResponse,
  } from "react-router";
  ```

---

## 2. Loader and Action Return Values

In SingleFetch mode:
- **DO NOT** use `json(...)` or `defer(...)`. These functions are deprecated in SingleFetch.
- **DO** return raw plain JavaScript objects directly:
  ```ts
  // ❌ DEPRECATED
  return json({ crags, total });

  // ✅ CORRECT
  return { crags, total };
  ```
- **DO** use `data(...)` from `react-router` only when you must set custom HTTP status codes or response headers:
  ```ts
  import { data } from "react-router";

  // When setting headers or status codes
  return data(
    { error: "Route not found" },
    { status: 404, headers: { "Cache-Control": "no-cache" } }
  );
  ```

---

## 3. UI and Styling Conventions
- Mantine v9 is the primary UI framework (`@mantine/core`, `@mantine/dates`, `@mantine/notifications`).
- Icons are from `@tabler/icons-react`.
- When creating UI components, use Mantine layouts (`Stack`, `Group`, `Container`, `Paper`, `Grid`) rather than inline styles.
