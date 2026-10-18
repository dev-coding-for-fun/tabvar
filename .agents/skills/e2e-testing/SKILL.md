---
name: e2e-testing
description: >-
  Use this skill when running, debugging, or writing Playwright end-to-end (E2E)
  tests in `e2e/`, adding role/persona access checks, or inspecting E2E failure
  traces and DOM snapshots.
---

# Playwright E2E Testing Guide for Coding Agents

This repository uses **Playwright** (`e2e/`) running against the local Cloudflare dev server (`http://127.0.0.1:5173`) and local D1 SQLite database.

---

## 1. Decision Gate: Vitest vs. Playwright (Avoid Test Bloat)

Before writing a Playwright test, verify that E2E is the right layer. Vitest unit/route tests run in milliseconds; Playwright tests launch a browser.

| What You Are Testing | Required Tool | Pattern |
| :--- | :--- | :--- |
| Loader data shaping, Kysely queries, form validation edge cases (400s), JSON API endpoints (`api.v1.*`) | **Vitest** (`app/routes/*.test.ts`) | Use `createMockDb` & `createRouteArgs` (see `test-writing` skill). |
| Route-level role/auth gates (`200` vs `403` vs `302 /login`) | **Playwright** [`e2e/access.spec.ts`](file:///x:/Documents/GitHub/tabvar/e2e/access.spec.ts) | Add **one row** to `accessRules`. Uses `request.get` without launching a browser tab. |
| Critical multi-step user journeys, client hydration, Mantine modals/drawers/comboboxes, multi-user handoffs | **Playwright** (`e2e/<feature>.spec.ts`) | Write **1–2 cohesive journey tests** per feature rather than many micro-tests. |

### Anti-Bloat Rules
- **Combine checkpoints into cohesive journeys:** Do not write 5 separate `test()` blocks that each `page.goto("/some-route")` to check a single heading or button. Navigate once and assert the structure (preferably with a scoped `toMatchAriaSnapshot`) and interactive flow.
- **Keep permutation matrices in Vitest:** Test exhaustive input validation permutations in Vitest route action tests; in Playwright, test at most the happy path and one representative error state.

---

## 2. Running & Debugging Tests (Context-Window Efficient)

Always use the compact agent runner scripts instead of raw `npx playwright test --reporter=list` to avoid flooding your context window with passing test logs:

```bash
# Full run (runs warmup + persona auth setup first, outputs 1 line on pass or compact failures)
npm run test:e2e:agent

# Single spec file (with setup)
npm run test:e2e:agent -- e2e/discount.spec.ts

# Fast iterative inner-loop (skips warmup & auth setup once e2e/.auth/*.json exist; stops on first failure)
npm run test:e2e:fast -- e2e/discount.spec.ts
```

### Diagnosing a Failure Without Guessing
When a test fails, `AgentReporter` prints:
1. The exact `file:line:column` and stripped assertion diff.
2. **Inline `Diagnostics`**: Any `pageerror`, `console.error`, or HTTP `>= 500` SSR responses captured automatically by [`e2e/support/test.ts`](file:///x:/Documents/GitHub/tabvar/e2e/support/test.ts). **Check this first**—a missing UI element is often caused by a backend 500 or hydration error.
3. **`Error Context (DOM/ARIA)` path** (`test-results/.../error-context.md`): Open this file with `view_file` to inspect the exact YAML ARIA tree of the page at the moment of failure.
4. **`Trace` path** (`test-results/.../trace.zip`): Inspect step-by-step history from the terminal without opening a GUI browser:
   ```bash
   npx playwright trace open test-results/<test-folder>/trace.zip
   npx playwright trace actions --errors-only
   npx playwright trace requests --failed
   npx playwright trace console --errors-only
   npx playwright trace snapshot <action-id>
   npx playwright trace close
   ```

### Live Exploration with `npx playwright cli`
When you need to inspect a live page to discover locators or verify UI structure without writing a test first:
```bash
npx playwright cli open http://127.0.0.1:5173
npx playwright cli state-load e2e/.auth/admin.json
npx playwright cli goto http://127.0.0.1:5173/discount
npx playwright cli snapshot "main" --depth=4
npx playwright cli find "Manage"
npx playwright cli --raw generate-locator e5
npx playwright cli close
```

---

## 3. Authoring Conventions & Fixtures

### Always Import from `./support/test`
ESLint (`no-restricted-imports`) forbids importing `test` or `expect` from `@playwright/test` in `e2e/*.spec.ts`. Always import from `./support/test`:

```ts
import { expect, test } from "./support/test";
```

### Personas & Multi-User Flows (`persona` & `pageAs`)
Never drive `/login` or Google OAuth in a spec. Personas are pre-authenticated in [`e2e/auth.setup.ts`](file:///x:/Documents/GitHub/tabvar/e2e/auth.setup.ts) and defined in [`e2e/support/personas.ts`](file:///x:/Documents/GitHub/tabvar/e2e/support/personas.ts) (`admin`, `super`, `member`, `anonymous`, `discountManager`, plus signed-out `guest`):

```ts
test.describe("as admin", () => {
  test.use({ persona: "admin" });

  test("manages discounts", async ({ page }) => {
    await page.goto("/discount");
    await expect(page.getByRole("heading", { name: "Manage Discounts" })).toBeVisible();
  });
});

// Multi-user handoff in a single test:
test("admin reviews a member submission", async ({ page, pageAs, uniqueName }) => {
  const title = uniqueName("Submission");
  // `page` is guest (or whatever test.use configured); open isolated pages per persona:
  const memberPage = await pageAs("member");
  const adminPage = await pageAs("admin");
  // ...
});
```

- **Exhaustive role checks:** When behaviour varies by persona, type expectations as `Record<SignedInPersona, ...>` (see [`e2e/discount.spec.ts`](file:///x:/Documents/GitHub/tabvar/e2e/discount.spec.ts)) so TypeScript flags missing personas if a new one is added.
- **Never mutate a shared persona's role or tags inside a test:** Parallel workers share `e2e/.auth/<persona>.json` and the DB user rows. Add a new persona in `e2e/support/personas.ts` if a distinct role/tag combination is needed.

### Parallel-Safe Data Mutations (`uniqueName`)
All workers run in parallel against the local D1 database. When a test creates or modifies records:
1. Use the `uniqueName(prefix)` fixture to generate a collision-free identifier (`"E2E Issue a1b2c3d4-1"`).
2. Scope assertions to the specific record you created (`page.getByRole("row", { name: title })`)—never assert hardcoded global table counts (`toHaveCount(5)`).

---

## 4. Locators, Assertions & Mantine v9 Recipes

### Locator Priority (Enforced by `eslint-plugin-playwright`)
1. `page.getByRole(...)` (headings, buttons, links, textboxes, dialogs, tabs)
2. `page.getByLabel(...)` / `page.getByPlaceholder(...)` (form controls)
3. `page.getByText(...)` (non-interactive text copy)
4. `page.getByTestId(...)` (only when semantic roles/labels are impractical)

**Forbidden anti-patterns (lint errors):**
- `page.waitForTimeout(...)` — always use web-first assertions (`await expect(locator).toBeVisible()`).
- `page.waitForLoadState("networkidle")` — wait for a specific UI element or response instead.
- Raw CSS/class selectors like `page.locator(".mantine-Button-root")`.

### Prefer Scoped `toMatchAriaSnapshot` for Structural Checks
Instead of chaining 6+ `toBeVisible()` assertions on static page structure, assert a scoped ARIA snapshot:

```ts
await expect(page.getByRole("main")).toMatchAriaSnapshot(`
  - heading "Exclusive Member Discount" [level=1]
  - heading "Manage Discounts" [level=2]
`);
```
*(Tip: Run `npx playwright test <spec> --no-deps -u` to auto-populate or update snapshots from the live DOM).*

### Mantine v9 Component Interaction Patterns
- **Mantine `Select` / `MultiSelect`:** Mantine renders a custom combobox (`textbox`), not a native `<select>`. Do not use `.selectOption()`. Instead:
  ```ts
  await page.getByRole("textbox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  ```
- **Mantine `Modal` / `Drawer`:** Scope locators inside the dialog portal:
  ```ts
  const dialog = page.getByRole("dialog", { name: "Edit Discount" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  ```
- **Mantine `ActionIcon`:** Always ensure `<ActionIcon aria-label="...">` has an `aria-label` in the React component so `page.getByRole("button", { name: "..." })` targets it cleanly.
