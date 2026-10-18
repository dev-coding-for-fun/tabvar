import { expect, test } from "./support/test";
import { personaSessionRequest, signedInPersonas } from "./support/personas";

// Guards the auth harness itself: if these fail, every other spec's results are suspect.
for (const persona of signedInPersonas) {
  test.describe(`as ${persona}`, () => {
    test.use({ persona });

    test("session resolves to the declared role and tags", async ({ page }) => {
      const expected = personaSessionRequest(persona);

      const response = await page.request.get("/api/whoami");
      expect(response.status()).toBe(200);
      const identity = await response.json();

      expect(identity).toMatchObject({ email: expected.email, role: expected.role });
      expect([...identity.tags].sort()).toEqual([...expected.tags].sort());
    });
  });
}

test("guest is signed out", async ({ page }) => {
  const response = await page.request.get("/api/whoami");
  expect(response.status()).toBe(401);
});

test("pageAs keeps each persona's session isolated", async ({ pageAs }) => {
  const [adminPage, memberPage] = await Promise.all([pageAs("admin"), pageAs("member")]);

  const [admin, member] = await Promise.all(
    [adminPage, memberPage].map(async (page) => (await page.request.get("/api/whoami")).json())
  );

  expect(admin.role).toBe("admin");
  expect(member.role).toBe("member");
});
