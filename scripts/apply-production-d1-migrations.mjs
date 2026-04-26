/* eslint-env node */

import { spawn } from "node:child_process";

const shouldRunMigrations =
  process.env.RUN_PRODUCTION_MIGRATIONS?.toLowerCase() === "true";

if (!shouldRunMigrations) {
  console.log(
    "Skipping production D1 migrations because RUN_PRODUCTION_MIGRATIONS is not true.",
  );
  process.exit(0);
}

const requiredEnvironmentVariables = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
];

const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name],
);

if (missingEnvironmentVariables.length > 0) {
  console.error(
    `Cannot run production D1 migrations. Missing environment variables: ${missingEnvironmentVariables.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

const wrangler = spawn(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--env", "production"],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

wrangler.on("error", (error) => {
  console.error("Failed to start Wrangler for production D1 migrations.");
  console.error(error);
  process.exit(1);
});

wrangler.on("close", (code, signal) => {
  if (signal) {
    console.error(`Wrangler exited because it received signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
