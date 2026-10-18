import { expect, test } from "./support/test";
import { personas, signedInPersonas } from "./support/personas";

/**
 * Role-gated pages. Add a row when a page gets a role check; every persona is
 * checked against it automatically. Gated loaders return 403 for signed-in users
 * without access and redirect guests to /login.
 */
const accessRules: { path: string; allowedRoles: string[] }[] = [
  { path: "/users", allowedRoles: ["admin"] },
  { path: "/admin/tags", allowedRoles: ["admin"] },
  { path: "/admin/query", allowedRoles: ["admin"] },
  { path: "/routes/manage", allowedRoles: ["admin"] },
  { path: "/routes/external", allowedRoles: ["admin"] },
  { path: "/topos/importmanager", allowedRoles: ["admin"] },
  { path: "/topos/jsonimport", allowedRoles: ["admin"] },
  { path: "/admin/submissions", allowedRoles: ["admin", "super"] },
  { path: "/issues/manage", allowedRoles: ["admin", "super", "member"] },
  { path: "/discount", allowedRoles: ["admin", "super", "member", "anonymous"] },
  { path: "/issues/create", allowedRoles: ["admin", "super", "member", "anonymous"] },
];

for (const persona of signedInPersonas) {
  test.describe(`as ${persona}`, () => {
    test.use({ persona });

    for (const { path, allowedRoles } of accessRules) {
      const allowed = allowedRoles.includes(personas[persona].role);

      test(`${allowed ? "can" : "cannot"} open ${path}`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBe(allowed ? 200 : 403);
      });
    }
  });
}

test.describe("as guest", () => {
  for (const { path } of accessRules) {
    test(`is sent to login from ${path}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe(`/login?redirectTo=${encodeURIComponent(path)}`);
    });
  }
});
