import crypto from "node:crypto";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { storageStatePath, type Persona } from "./personas";

interface PersonaFixtures {
  /** Who the default `page`/`context` are signed in as. Set with `test.use({ persona })`. */
  persona: Persona;
  /** Opens an extra page signed in as another persona, for multi-user flows in one test. */
  pageAs: (persona: Persona) => Promise<Page>;
  /**
   * Generates a unique, parallel-safe name for test records written to the shared
   * local D1 database (e.g. `uniqueName("Discount")` -> `"E2E Discount a1b2c3d4-1"`).
   */
  uniqueName: (prefix: string) => string;
  /** Internal fixture that records pageerror, console.error, and HTTP >= 500 responses. */
  _diagnostics: (page: Page, label: string) => void;
}

export const test = base.extend<PersonaFixtures>({
  persona: ["guest", { option: true }],

  storageState: async ({ persona }, use) => {
    await use(storageStatePath(persona));
  },

  // Lazy (not `{ auto: true }` on `page`) so `{ request }`-only specs never spawn a browser tab.
  _diagnostics: async ({}, use, testInfo) => {
    const logs: string[] = [];

    const trackPage = (targetPage: Page, label: string) => {
      targetPage.on("pageerror", (error) => {
        logs.push(`[${label} pageerror] ${error.message}`);
      });
      targetPage.on("console", (msg) => {
        if (msg.type() === "error") {
          logs.push(`[${label} console.error] ${msg.text()}`);
        }
      });
      targetPage.on("response", (response) => {
        if (response.status() >= 500) {
          logs.push(
            `[${label} HTTP ${response.status()}] ${response.request().method()} ${response.url()}`
          );
        }
      });
    };

    await use(trackPage);

    if (testInfo.status !== testInfo.expectedStatus && logs.length > 0) {
      await testInfo.attach("diagnostics", {
        body: logs.join("\n"),
        contentType: "text/plain",
      });
    }
  },

  page: async ({ page, persona, _diagnostics }, use) => {
    _diagnostics(page, persona);
    await use(page);
  },

  pageAs: async ({ browser, baseURL, _diagnostics }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (persona) => {
      const context = await browser.newContext({
        baseURL,
        storageState: storageStatePath(persona),
      });
      contexts.push(context);
      const newPage = await context.newPage();
      _diagnostics(newPage, `pageAs(${persona})`);
      return newPage;
    });

    await Promise.all(contexts.map((context) => context.close()));
  },

  uniqueName: async ({}, use) => {
    const runToken = crypto.randomUUID().slice(0, 8);
    let counter = 0;
    await use((prefix: string) => {
      counter += 1;
      return `E2E ${prefix} ${runToken}-${counter}`;
    });
  },
});

export { expect };
