import { expect, test as setup } from "@playwright/test";

// On a cold Vite cache (fresh checkout, CI) the dev server optimizes client deps on
// the first page load, and concurrent loads during that window fail to import
// entry.client. Load the app once, cleanly, before the parallel suite fans out.
setup("warm up dev server", async ({ page }) => {
  await expect(async () => {
    const errors: Error[] = [];
    const onError = (error: Error) => errors.push(error);
    page.on("pageerror", onError);
    try {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    } finally {
      page.off("pageerror", onError);
    }
  }).toPass({ timeout: 90_000 });
});
