import { cleanE2EData } from "../../scripts/clean-e2e-data.mjs";

export default function globalTeardown() {
  if (process.env.KEEP_E2E_DATA) {
    console.log("[Playwright Teardown] KEEP_E2E_DATA set; skipping database cleanup.");
    return;
  }
  cleanE2EData({ quiet: true });
}
