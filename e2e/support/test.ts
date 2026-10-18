import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { storageStatePath, type Persona } from "./personas";

interface PersonaFixtures {
  /** Who the default `page`/`context` are signed in as. Set with `test.use({ persona })`. */
  persona: Persona;
  /** Opens an extra page signed in as another persona, for multi-user flows in one test. */
  pageAs: (persona: Persona) => Promise<Page>;
}

export const test = base.extend<PersonaFixtures>({
  persona: ["guest", { option: true }],

  storageState: async ({ persona }, use) => {
    await use(storageStatePath(persona));
  },

  pageAs: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (persona) => {
      const context = await browser.newContext({
        baseURL,
        storageState: storageStatePath(persona),
      });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from "@playwright/test";
