# End-to-end testing (Playwright)

E2E specs live in `e2e/` and run against the local dev server (`npm run dev`, Cloudflare `env.dev`, local D1).

```bash
npx playwright install chromium   # once per machine
npm run test:e2e                  # starts the dev server unless one is already running on :5173
npm run test:e2e:ui               # interactive runner
```

Apply local migrations first (`npm run db:migrate:local`): personas are written to the local D1 database.

## How auth works

Tests never drive Google OAuth or the email-code form. Instead:

1. **Personas** (`e2e/support/personas.ts`) declare every user the suite can act as: role, user tags, and disclaimer state.
2. **`e2e/auth.setup.ts`** runs once per `npm run test:e2e`. For each persona it calls the dev-only `POST /e2e/session` route, which upserts the user `<persona>@e2e.test` with exactly the declared role and tags (tags not in the list are removed), then issues the normal `_session` cookie. The cookie is saved to `e2e/.auth/<persona>.json` (gitignored). A `guest` state, signed out with the safety disclaimer already dismissed, is written as well.
3. **Specs pick a persona** and start signed in. No login steps run inside tests.

`POST /e2e/session` (`app/routes/e2e.session.ts`) is guarded three ways:

- Production builds do not register it (`app/routes.ts` ignores `e2e.*` when `NODE_ENV=production`, which `vite build` sets).
- At runtime it answers only when `ENVIRONMENT=dev` and the request host is loopback. Anything else gets a 404.
- It only creates or modifies users in the `@e2e.test` domain, so real accounts copied into a local database are never touched. Unknown tag names are rejected with a 400.

## Writing specs

Import `test`/`expect` from `./support/test`, not from `@playwright/test`:

```ts
import { expect, test } from "./support/test";

test.describe("as admin", () => {
  test.use({ persona: "admin" });

  test("sees discount management", async ({ page }) => {
    await page.goto("/discount");
    await expect(page.getByRole("heading", { name: "Manage Discounts" })).toBeVisible();
  });
});
```

- **Default persona is `guest`.** Use `test.use({ persona })` per file or `describe`.
- **Multi-user flows:** `pageAs(persona)` opens an extra, isolated page signed in as someone else, e.g. a member submits, then an admin reviews in the same test:
  ```ts
  test.use({ persona: "member" });

  test("admin reviews a member submission", async ({ page, pageAs }) => {
    // `page` is the member; `admin` is a second, separately signed-in browser context.
    const admin = await pageAs("admin");
  });
  ```
- **Permission checks are data-driven.** For a role-gated page, add a row to `accessRules` in `e2e/access.spec.ts`. Every persona and the guest are checked against it automatically. Prefer `page.request.get(path, { maxRedirects: 0 })` for pure access checks: it asserts the server status without rendering.
- **Parametrize, don't copy.** Loop over personas (`signedInPersonas`, or a `Record<SignedInPersona, …>` of expectations as in `e2e/discount.spec.ts`) instead of duplicating tests per role. Using a `Record` keyed by `SignedInPersona` makes TypeScript flag specs that miss a newly added persona.

### Adding a persona

Add an entry to `personas` in `e2e/support/personas.ts`. Tags must already exist in `user_tag` (created by migrations). Never change a shared persona's role or tags inside a test: workers run in parallel and share them. If a test needs a different state, declare a new persona.

## Notes

- `e2e/personas.spec.ts` checks the harness itself through `/api/whoami`. If it fails, distrust the rest of the run.
- `e2e/warmup.setup.ts` loads the app once before the parallel run. On a cold Vite cache (fresh checkout, CI), concurrent first loads fail to import `entry.client` while dependencies are being optimized.
- R2 bindings in `env.dev` point at the remote `-dev` buckets, so specs that upload files write there.
