import { expect, test } from "./support/test";

test("visitors can explore the ballot and a signed-in climber can vote once", async ({ page, uniqueName }) => {
  await page.goto("/goldencrowbar");
  await expect(page.getByRole("heading", { name: "Golden Crowbar 2026" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ethan Woodside" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore the 2025 award" })).toHaveAttribute("href", "/goldencrowbar/2025");

  // The vote journey cannot run after the actual deadline.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(await page.getByText("Voting is closed").isVisible(), "The 2026 ballot is closed.");

  await expect(page.getByRole("link", { name: "Sign in to vote", exact: true })).toBeVisible();
  const displayName = uniqueName("Crowbar Voter");
  const email = `${displayName.replaceAll(" ", "-").toLowerCase()}@e2e.test`;
  const session = await page.request.post("/e2e/session", {
    data: { email, displayName, role: "member", tags: [], disclaimerAcknowledged: true },
    maxRedirects: 0,
  });
  expect(session.status()).toBe(302);
  await page.goto("/goldencrowbar");
  await page.getByRole("radio", { name: "Vote for Ethan Woodside" }).check();
  await page.getByRole("button", { name: "Cast my vote" }).click();
  await expect(page.getByText("Your vote for Ethan Woodside has been recorded.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Your vote for Ethan Woodside has been recorded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cast my vote" })).toHaveCount(0);
});
