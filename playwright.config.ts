import { defineConfig, devices } from "@playwright/test";

// The dev server binds to IPv4 loopback (vite.config.mts), and the e2e session route
// only answers on loopback hosts.
const baseURL = "http://127.0.0.1:5173";

const isCI = !!process.env.CI;
const isAgent = !!(
  process.env.AGENT ||
  process.env.CLAUDECODE ||
  process.env.CURSOR_AGENT ||
  process.env.CODEX_SANDBOX ||
  process.env.ANTIGRAVITY_AGENT
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  maxFailures: isAgent ? 5 : undefined,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : isAgent
      ? "./e2e/support/agent-reporter.ts"
      : "list",
  use: {
    baseURL,
    actionTimeout: 10_000,
    // Keep traces for local failures (where retries=0) so `npx playwright trace` works.
    trace: isCI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    // Warms the dev server (absorbing any cold Vite dep-optimization restart) before parallel workers fan out.
    { name: "warmup", testMatch: /warmup\.setup\.ts/ },
    // Signs in every persona once per run after the dev server is warm.
    { name: "setup", testMatch: /auth\.setup\.ts/, dependencies: ["warmup"] },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: isAgent ? "ignore" : "pipe",
  },
});
