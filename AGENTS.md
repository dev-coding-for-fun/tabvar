# AGENTS.md

Repository guidance for **demofinder** (also known as **tabvar**).

## Implementation

- Complete the requested behavior end to end with a focused, coherent change.
  Preserve unrelated work and existing public contracts unless the task changes them.
- Use the relevant existing implementation and tests to establish local conventions.
  Reuse established utilities and patterns where they fit.
- Introduce dependencies, abstractions, configuration, and extension points only
  when the current requirements justify them. Avoid speculative generalization.
- Resolve uncertain APIs and commands from project scripts, installed types/source,
  or documentation matching the installed version. Do not invent interfaces.
- Handle realistic failures at the appropriate boundary. Preserve useful error
  information; avoid silent fallbacks or broad catches that conceal broken behavior.
- Keep comments focused on non-obvious intent and constraints. Update documentation
  affected by the change; avoid unrelated documentation and formatting churn.

## Correctness and completion

- Implement the general behavior required by the task, including relevant edge cases.
  Do not hardcode test examples or weaken checks to conceal defects. Change test
  expectations when the intended contract changes, and explain why.
- For changed behavior, add or update focused coverage when existing tests would
  miss a meaningful regression. Test observable behavior rather than copying the
  implementation into assertions.
- Use the required checks below for the affected area. After they pass, repeat or
  broaden checks only for subsequent changes, failures, or unresolved risks.
- Report the result, checks actually run and their outcomes, and any remaining
  limitation. Distinguish a passing check from one that could not run.
- Make routine implementation decisions within the requested scope. Clarify an
  ambiguity when different interpretations would materially change the result.

---

## System Overview & Tech Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Framework** | React Router v8 | SSR enabled (`react-router.config.ts`), Vite-powered, SingleFetch mode |
| **Runtime** | Cloudflare Workers with Static Assets | Edge runtime (`nodejs_compat` compatibility flag, migrating from Pages) |
| **Database** | Cloudflare D1 | Serverless SQLite managed via Wrangler and queried via **Kysely** |
| **Storage** | Cloudflare R2 | S3-compatible bucket for topos and issue attachments |
| **UI** | Mantine v9 | `@mantine/core`, `@mantine/dates`, `@mantine/tiptap`, Tabler Icons, Mapbox GL |
| **Testing** | Vitest | `happy-dom` environment, fluent Kysely mocks in `app/test/helpers.ts` |
| **AI / Moderation** | Google Generative AI | `@google/generative-ai` for automated issue moderation (`moderation.server.ts`) |

---

## Invariants & Golden Rules

Agents working in this codebase **must** adhere to the following rules:

### A. React Router v8 Conventions
- **DO NOT** import from `@remix-run/*` or `react-router-dom` (removed in v8). Always import directly from `react-router` (or `react-router/dom` for DOM-specific providers).
- **DO NOT** use `json(...)` or `defer(...)` in loaders or actions.
- **DO** return raw plain objects directly from loaders and actions:
  ```ts
  // ❌ INCORRECT (Legacy Remix pattern)
  return json({ issues });

  // ✅ CORRECT (React Router v8 SingleFetch)
  return { issues };
  ```
- **DO** use `data(payload, { status, headers })` from `react-router` only when you must set custom status codes or HTTP headers:
  ```ts
  import { data } from "react-router";

  return data({ error: "Unauthorized" }, { status: 401 });
  ```
- **DO** use `loaderData` (not `data`) in `meta` functions:
  ```ts
  export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
    return [{ title: loaderData?.title }];
  };
  ```

### B. Cloudflare Edge Runtime Constraints
- The backend runs on Cloudflare Workers edge infrastructure (`workers/app.ts`) serving static assets from `build/client`.
- Local development is powered by `@cloudflare/vite-plugin` running the Worker environment natively in `workerd`.
- **DO NOT** import non-polyfilled Node.js built-ins (`node:fs`, `child_process`, etc.) into `app/` routes or server libraries.
- For supported Node built-ins (`crypto`, `buffer`, `util`, `path`, `stream`), use the `node:` prefix (e.g. `import crypto from "node:crypto"`).
- **DO NOT** read secrets from `process.env`. Access environment variables and bindings via `context.cloudflare.env` (typed via `RouterContextProvider` augmentation in `load-context.ts`):
  ```ts
  export async function loader({ context }: Route.LoaderArgs) {
    const env = context.cloudflare.env;
    const db = getDB(context);
    const bucket = env.TABVAR_ISSUES_UPLOADS;
  }
  ```

### C. Testing with `app/test/helpers.ts`
- **DO NOT** hand-roll custom Kysely database mocks or start external servers.
- **DO** reuse the utilities in `app/test/helpers.ts`:
  - `createMockDb({ select: [...], insert: [...], update: [...] })`: Fluent query mock supporting `.selectFrom()`, `.insertInto()`, `.updateTable()`, `.where()`, etc.
  - `createRouteArgs({ request, context, params })`: Constructs properly typed arguments for loaders and actions.
  - `createContext(...)`: Supplies a mock `AppLoadContext` with Cloudflare bindings.
  - `await readJson(response)`: Reads and parses data from either a raw `Response` or a `DataWithResponseInit` object.
  - `createUser(...)`: Mock authenticated user generator.

### D. Dependency Cascades & Collaborative Planning
- If an upgrade, refactor, or new capability triggers a cascading dependency chain (e.g. a major framework bump requiring runtime changes, dev-server plugin replacements, context/typing shifts, or deprecations across layers), stop code modifications and destructive actions. Explain the affected layers, breaking changes, and trade-offs; obtain user alignment on a step-by-step plan before modifying dependencies or code.

### E. Type Hygiene: Reuse Canonical Types Over Ad-Hoc Interfaces
- **DO NOT** invent ad-hoc interface wrappers for arguments already typed by the framework or runtime (e.g. do NOT define custom `interface AuthArgs` or `interface MyLoaderContext` when `LoaderFunctionArgs` / `ActionFunctionArgs` already exist).
- **DO NOT** declare shadow types that duplicate database tables or domain models; import from `~/lib/models` or `~/lib/db.d.ts`.
- **DO NOT** over-correct by using `any`, `unknown`, or omitting types.
- **DO** reuse and extend framework types:
  - For route loaders/actions: use `LoaderFunctionArgs` / `ActionFunctionArgs` (or `Pick<LoaderFunctionArgs, "request" | "context">` if only a subset is accepted).
  - For UI components: reuse or extend Mantine types (e.g. `ButtonProps`, `TextInputProps`).
- **DO** create new interfaces/types when introducing:
  - Props for new React components (`interface SectorCardProps`).
  - Distinct API payload schemas / external contract shapes (e.g. mobile sync payloads).
  - New domain models or state machines that do not exist yet.

### F. Wrangler Configuration & Environment Invariants
- **Top-Level is Production (Safe by Default)**: The top level of `wrangler.json` represents the canonical production Worker (`tabvar`). It MUST ALWAYS bind to `tabvar-issues-uploads` and `tabvar-topos`. **NEVER** put `remote: true` or `-dev` bucket names in the top-level configuration.
- **Local Dev uses `env.dev`**: Local development (`npm run dev`) activates the `dev` environment via `CLOUDFLARE_ENV=dev` (configured automatically in `vite.config.mts`). The `env.dev` block in `wrangler.json` binds to `tabvar-issues-uploads-dev` and `tabvar-topos-dev` with `"remote": true` and sets `"routes": []` to prevent domain collisions.
- **No Staging or Production Sub-blocks**: Do not add `env.production` or `env.staging`. Production is strictly the top-level configuration.
- **Declarative Buckets**: Do not hardcode R2 bucket names or bindings in `vite.config.mts`. All bindings are declared purely in `wrangler.json`.

---

## Cloudflare Wrangler & D1 Database Workflow

Cloudflare D1 is a serverless SQLite database. In this repository, **Wrangler** manages D1 migrations, and **Kysely** provides type-safe SQL query building.

### Database Architecture
- **Binding Name**: `DB` (configured in `wrangler.json` under `d1_databases`).
- **Local SQLite File**: Wrangler persists local state to `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`.
- **Database URL**: `.env` points `DATABASE_URL` to this local SQLite file.
- **Generated Types**: `app/lib/db.d.ts` is generated by `kysely-codegen` based on the local SQLite schema.

### The 4-Step Migration Workflow
Whenever adding, altering, or dropping tables, columns, or triggers:

#### Step 1: Create a Migration File
Run Wrangler to generate a sequentially numbered migration file:
```bash
npx wrangler d1 migrations create DB <migration_name>
```
This creates a new file in `migrations/` (e.g., `migrations/0060_<migration_name>.sql`).

#### Step 2: Write SQLite-Compatible SQL
Write your migration in standard SQLite 3 dialect:
- Remember SQLite constraints (e.g. strict types, triggers, `DATETIME('now')`, `strftime`).
- Review existing migrations in `migrations/` for established table patterns, triggers, and search indexing (FTS).

#### Step 3: Apply Migrations Locally
Apply the new migration to your local Miniflare SQLite database:
```bash
npx wrangler d1 migrations apply DB --local
```
*(Verify migration status at any time with `npx wrangler d1 migrations list DB --local`)*.

#### Step 4: Regenerate TypeScript Definitions
Update `app/lib/db.d.ts` and worker bindings:
```bash
npm run typegen
```
*(This command runs `wrangler types` and `kysely-codegen`, refreshing `app/lib/db.d.ts` from the local SQLite database).*

### Useful D1 Inspection Commands
- **Run ad-hoc queries on local D1**:
  ```bash
  npx wrangler d1 execute DB --local --command "SELECT * FROM issue LIMIT 5;"
  ```
- **Execute a SQL script locally**:
  ```bash
  npx wrangler d1 execute DB --local --file ./seed_route_data.sql
  ```

### Production Migrations
Production migrations are automated in CI during Cloudflare Pages builds (`npm run build:cloudflare`), executing `scripts/apply-production-d1-migrations.mjs`. **Never** run remote production migrations without explicit human approval.

---

## Setup & Required Checks

- Use Node.js `24.15.0` from `.nvmrc` (supported range: `>=22.22.0`) and npm `11.12.1` from `package.json`.
- Run `npm ci` from the repository root to install dependencies from `package-lock.json`. Use npm for dependency changes and keep the lockfile in sync. `.npmrc` configures `legacy-peer-deps=true`.
- Run `npm run verify` before completing a task; it runs both typecheck and tests. Use focused tests during implementation, and run lint or build when changes affect lint configuration or bundling/runtime integration, respectively.
- Deployment commands and `build:cloudflare` can affect Cloudflare resources; use `npm run build` for local build validation.

| Purpose | Command | Notes |
| :--- | :--- | :--- |
| **Verify All** | `npm run verify` | Runs `typecheck && test` |
| **Start Dev Server** | `npm run dev` | Runs React Router dev server on `127.0.0.1` |
| **Run All Tests** | `npm test` | Runs Vitest once |
| **Run Specific Test** | `npx vitest run <path-to-test>` | E.g. `npx vitest run app/routes/api.issues.test.ts` |
| **Run Tests in Watch Mode** | `npm run test:watch` | Vitest interactive watcher |
| **Typecheck** | `npm run typecheck` | Runs `react-router typegen && tsc` |
| **Lint** | `npm run lint` | ESLint |
| **Database Codegen** | `npm run typegen` | Runs `wrangler types` and `kysely-codegen` |
| **List Local Migrations** | `npm run db:list:local` | (or `npx wrangler d1 migrations list DB --local`) |
| **Apply Local Migrations** | `npm run db:migrate:local` | (or `npx wrangler d1 migrations apply DB --local`) |
| **Build Project** | `npm run build` | Compiles client and server bundles |
| **Deploy Worker (Side-by-Side)** | `npm run deploy:worker` | Builds and deploys to Cloudflare Workers |

---

## Repository Layout & Key Paths

```
demofinder/
├── .agents/
│   └── skills/           # Repository skills (d1-migration, issue-sync-api, rr7-route-creator, test-writing)
├── app/
│   ├── components/       # Mantine UI components (GlobalBanner, TopoGallery, etc.)
│   ├── contexts/         # React contexts (e.g. search context)
│   ├── lib/
│   │   ├── db.ts         # getDB(context) accessor for Kysely instance
│   │   ├── db.d.ts       # AUTOGENERATED Kysely database schema types
│   │   ├── models.ts     # Domain models and TypeScript interfaces
│   │   ├── apiAuth.server.ts # Token validation for mobile / external API clients
│   │   ├── auth.server.ts    # Web session authentication and Google OAuth
│   │   ├── moderation.server.ts # Gemini AI auto-moderation logic
│   │   ├── attachment.server.ts # S3/R2 presigned upload URL helpers
│   │   └── topoSync.server.ts   # TopoBuilder sync utilities
│   ├── routes/           # React Router v8 file-system routes
│   │   ├── api.v1.*      # External & mobile JSON endpoints (TopoBuilder sync)
│   │   ├── issues.*      # Issue creation, listing, and management routes
│   │   ├── topos.*       # Crag topo visualization and JSON importer
│   │   └── admin.*       # Administrative routes and queries
│   └── test/
│       └── helpers.ts    # Fluent mock database, request, and context helpers
├── workers/
│   └── app.ts            # Cloudflare Workers entry point for React Router v8
├── docs/
│   └── issue-sync-api.md # Comprehensive spec for the v1 mobile sync API
├── migrations/           # Sequentially numbered D1 SQL migrations (0001_...)
├── scripts/              # Build and production migration runners
├── mcp_config.example.json # Template for local MCP server definitions (mcp_config.json is gitignored)
├── wrangler.json         # Cloudflare Workers, Assets, D1, and R2 bindings configuration
├── load-context.ts       # Augmentation for React Router RouterContextProvider
└── react-router.config.ts# React Router v8 configuration (SSR enabled)
```

---

## Read when relevant

- `.agents/skills/rr7-route-creator/SKILL.md`: consult when adding or refactoring React Router routes, loaders/actions, error boundaries, or Mantine UI.
- `.agents/skills/test-writing/SKILL.md` and `app/test/helpers.ts`: consult when adding or updating Vitest coverage.
- `.agents/skills/d1-migration/SKILL.md` and existing `migrations/`: consult for D1 schema changes or database type generation.
- `.agents/skills/issue-sync-api/SKILL.md` and `docs/issue-sync-api.md`: consult for mobile sync, TopoBuilder sync, attachments, or delta sync.
- `app/routes/api.v1.issues.ts`, `app/routes/api.v1.issues.sync.ts`, and their corresponding `.test.ts` files: reference implementations and coverage for v1 issue sync endpoints.
