import { expect, test } from "./support/test";
import type { SignedInPersona } from "./support/personas";

// Discount management is granted by role (admin) or by tag (supporter_prog_manager).
const managementAccess: Record<SignedInPersona, boolean> = {
  admin: true,
  discountManager: true,
  super: false,
  member: false,
  anonymous: false,
};

for (const [persona, canManage] of Object.entries(managementAccess) as [SignedInPersona, boolean][]) {
  test.describe(`as ${persona}`, () => {
    test.use({ persona });

    test(`${canManage ? "sees" : "does not see"} discount management`, async ({ page }) => {
      await page.goto("/discount");

      await expect(page.getByRole("heading", { name: "Exclusive Member Discount" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Manage Discounts" })).toBeVisible({
        visible: canManage,
      });
    });
  });
}
