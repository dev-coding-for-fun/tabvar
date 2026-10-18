---
name: e2e-testing
description: >-
  Use this skill when verifying UI changes in a real browser via `npx playwright cli`,
  or when running, debugging, or writing Playwright end-to-end (E2E) tests in `e2e/`,
  adding role/persona access checks, or inspecting E2E failure traces and DOM snapshots.
---

# Browser Verification & Playwright E2E Guide for Coding Agents

This repository uses a **two-tier browser workflow** against the local Cloudflare dev server (`http://127.0.0.1:5173`) and local D1 SQLite database:
1. **Tier 1 — Self-Directed Browser Verification (`npx playwright cli`)**: Drive a persistent headless browser via CLI commands to verify UI work, check console/network health, or extract exact locators **without writing a test file**.
2. **Tier 2 — Committed Automated Tests (Vitest & Playwright `e2e/*.spec.ts`)**: Permanent regression tests reserved for route logic (Vitest), role gates (`e2e/access.spec.ts`), and critical multi-step user journeys (`e2e/<feature>.spec.ts`).

---

## 1. Decision Gate: How Should You Verify Your Change?

Do **not** author and commit a new Playwright `.spec.ts` file just to check if your UI change rendered properly. Pick the lightest tool that proves correctness:

| Goal | Required Tool | Pattern |
| :--- | :--- | :--- |
| Verify a UI change interactively, check layout/ARIA tree, or confirm zero console/SSR errors | **Tier 1: `npx playwright cli`** | Open browser, `state-load e2e/.auth/<persona>.json`, interact, inspect `snapshot`/`console`/`network`, then `close`. |
| Loader data shaping, Kysely queries, form validation edge cases (400s), JSON API endpoints (`api.v1.*`) | **Vitest** (`app/routes/*.test.ts`) | Use `createMockDb` & `createRouteArgs` (see `test-writing` skill). Runs in milliseconds. |
| Route-level role/auth gates (`200` vs `403` vs `302 /login`) | **Playwright** [`e2e/access.spec.ts`](file:///x:/Documents/GitHub/tabvar/e2e/access.spec.ts) | Add **one row** to `accessRules`. Uses `request.get` without launching a browser tab. |
| Critical multi-step user journeys, client hydration, Mantine modals/drawers/comboboxes, multi-user handoffs | **Tier 2: Playwright** (`e2e/<feature>.spec.ts`) | Write **1–2 cohesive journey tests** per feature rather than many micro-tests. |

---

## 2. Tier 1: Self-Directed Browser Verification (`npx playwright cli`)

`@playwright/test` includes `npx playwright cli` (configured via [`.playwright/cli.config.json`](file:///x:/Documents/GitHub/tabvar/.playwright/cli.config.json) to use Playwright's bundled `chromium`). It writes compact YAML ARIA snapshots (`[ref=eN]`) to `.playwright-cli/` on disk (gitignored) instead of flooding your context window.

### Prerequisite
Ensure the dev server (`npm run dev -- --port 5173 --strictPort`) is running in the background. If `e2e/.auth/*.json` do not exist yet, run `npx playwright test --project=setup` once to mint all persona cookies.

### Running Commands (Single-Turn vs. Multi-Turn)
Because agent shell tools terminate child processes when a non-daemon command exits:
- **For a quick check in one turn:** Chain `open` through `close` in a single command (`;`).
- **For multi-turn interactive exploration:** Start `node node_modules/playwright-core/lib/entry/cliDaemon.js default` as a background daemon (`IsDaemon: true`) first; it stays alive across turns and exits automatically when you run `npx playwright cli close`.

```bash
# 1. Open (or attach to) the browser and load a pre-authenticated persona cookie
#    Available personas: admin, super, member, anonymous, discountManager, guest
npx playwright cli open http://127.0.0.1:5173
npx playwright cli state-load e2e/.auth/admin.json
npx playwright cli goto http://127.0.0.1:5173/admin/query

# 2. Inspect the YAML ARIA snapshot written to .playwright-cli/page-*.yml (via view_file)
#    or take a scoped snapshot:
npx playwright cli snapshot "main" --depth=4

# 3. Interact using [ref=eN] handles from the snapshot
npx playwright cli fill e101 "SELECT email, role FROM user WHERE email LIKE '%@e2e.test' ORDER BY email;"
npx playwright cli click e102

# 4. Check for runtime console errors or extract a canonical Playwright locator
npx playwright cli console error
npx playwright cli --raw generate-locator e102

# 5. Always close the browser daemon when done
npx playwright cli close
```

---

## 3. Tier 2: Running & Debugging E2E Specs

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

---

## 4. Authoring Conventions, Fixtures & Mantine v9 Recipes

### Anti-Bloat Rules
- **Combine checkpoints into cohesive journeys:** Do not write 5 separate `test()` blocks that each `page.goto("/some-route")` to check a single heading or button. Navigate once and assert the structure (preferably with a scoped `toMatchAriaSnapshot`) and interactive flow.
- **Keep permutation matrices in Vitest:** Test exhaustive input validation permutations in Vitest route action tests; in Playwright, test at most the happy path and one representative error state.

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
test("admin reviews a member submission", async ({ pageAs, uniqueName }) => {
  const title = uniqueName("Submission");
  const memberPage = await pageAs("member");
  const adminPage = await pageAs("admin");
  // ...
});
```

- **Exhaustive role checks:** When behavior varies by persona, type expectations as `Record<SignedInPersona, ...>` (see [`e2e/discount.spec.ts`](file:///x:/Documents/GitHub/tabvar/e2e/discount.spec.ts)) so TypeScript flags missing personas if a new one is added.
- **Never mutate a shared persona's role or tags inside a test:** Parallel workers share `e2e/.auth/<persona>.json` and the DB user rows. Add a new persona in `e2e/support/personas.ts` if a distinct role/tag combination is needed.

### Parallel-Safe Data Mutations (`uniqueName`)
All workers run in parallel against the local D1 database. When a test creates or modifies records:
1. Use the `uniqueName(prefix)` fixture to generate a collision-free identifier (`"E2E Issue a1b2c3d4-1"`).
2. Scope assertions to the specific record you created (`page.getByRole("row", { name: title })`)—never assert hardcoded global table counts (`toHaveCount(5)`).

### Locators, Assertions & Mantine v9 Recipes
1. `page.getByRole(...)` (headings, buttons, links, textboxes, dialogs, tabs)
2. `page.getByLabel(...)` / `page.getByPlaceholder(...)` (form controls)
3. `page.getByText(...)` (non-interactive text copy)
4. `page.getByTestId(...)` (only when semantic roles/labels are impractical)

**Forbidden anti-patterns (enforced by `eslint-plugin-playwright`):**
- `page.waitForTimeout(...)` — always use web-first assertions (`await expect(locator).toBeVisible()`).
- `page.waitForLoadState("networkidle")` — wait for a specific UI element or response instead.
- Raw CSS/class selectors like `page.locator(".mantine-Button-root")`.

**Scoped `toMatchAriaSnapshot` for Structural Checks:**
Instead of chaining 6+ `toBeVisible()` assertions on static page structure, assert a scoped ARIA snapshot:

```ts
await expect(page.getByRole("main")).toMatchAriaSnapshot(`
  - heading "Exclusive Member Discount" [level=1]
  - heading "Manage Discounts" [level=2]
`);
```
*(Tip: Run `npx playwright test <spec> --no-deps -u` to auto-populate or update snapshots from the live DOM).*

**Mantine v9 Component Interactions:**
- **Mantine `Select` / `MultiSelect`:** Renders a custom combobox (`textbox`), not a native `<select>`. Do not use `.selectOption()`:
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
