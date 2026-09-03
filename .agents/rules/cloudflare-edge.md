# Cloudflare Edge Runtime Invariant Rules

The server application runs on **Cloudflare Workers / Pages Functions** with the `nodejs_compat` compatibility flag.

---

## 1. Node.js Built-in Restrictions
- The runtime is NOT a traditional Node.js process. Native Node modules (such as `fs`, `child_process`, `net`, `os`) are not supported in application code under `app/`.
- For polyfilled Node.js built-ins (`crypto`, `buffer`, `util`, `path`, `stream`, `events`), **ALWAYS** use the explicit `node:` prefix:
  ```ts
  // ❌ AVOID
  import crypto from "crypto";

  // ✅ CORRECT
  import crypto from "node:crypto";
  import { Buffer } from "node:buffer";
  ```

---

## 2. Environment Variables & Cloudflare Bindings
- **DO NOT** read application secrets or environment configuration from `process.env` in `app/` routes or server libraries.
- **ALWAYS** access bindings via `context.cloudflare.env` provided by `AppLoadContext`:
  ```ts
  import type { Route } from "./+types/my-route";
  import { getDB } from "~/lib/db";

  export async function loader({ context }: Route.LoaderArgs) {
    const env = context.cloudflare.env;
    const db = getDB(context);
    const bucket = env.TABVAR_ISSUES_UPLOADS;
  }
  ```

---

## 3. Database Access
- Cloudflare D1 is accessed using the Kysely wrapper in `app/lib/db.ts`:
  ```ts
  import { getDB } from "~/lib/db";

  const db = getDB(context);
  const issues = await db.selectFrom("issue").selectAll().execute();
  ```
- Do not instantiate separate SQLite connections in route code.
