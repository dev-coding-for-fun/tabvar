import { expect, test } from "./support/test";
import type { SignedInPersona } from "./support/personas";

// Discount management is granted by role (admin) or by tag (supporter_prog_manager).
const managementAccess: Record<SignedInPersona, boolean> = {
  admin: true,
  discountManager: true,
  super: false,
  member: false,
  anonymous: false,
  contributor: false,
  editor: false,
};

for (const [persona, canManage] of Object.entries(managementAccess) as [SignedInPersona, boolean][]) {
  test.describe(`as ${persona}`, () => {
    test.use({ persona });

    if (canManage) {
      test("sees discount management", async ({ page }) => {
        await page.goto("/discount");

        await expect(page.getByRole("heading", { name: "Exclusive Member Discount" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Manage Discounts" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Email address" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Add super supporter" })).toBeVisible();
      });
    } else {
      test("does not see discount management", async ({ page }) => {
        await page.goto("/discount");

        await expect(page.getByRole("heading", { name: "Exclusive Member Discount" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Manage Discounts" })).toBeHidden();
      });
    }
  });
}
