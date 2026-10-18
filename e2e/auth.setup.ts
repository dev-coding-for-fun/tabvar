import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { GUEST_DISCLAIMER_ACK_KEY } from "../app/components/DisclaimerAcknowledgement";
import {
  personaSessionRequest,
  signedInPersonas,
  storageStatePath,
} from "./support/personas";

for (const persona of signedInPersonas) {
  setup(`sign in ${persona}`, async ({ request }) => {
    const response = await request.post("/e2e/session", {
      data: personaSessionRequest(persona),
      maxRedirects: 0,
    });
    expect(response.status(), await response.text()).toBe(302);

    await request.storageState({ path: storageStatePath(persona) });
  });
}

setup("prepare guest", async ({ baseURL }) => {
  const file = storageStatePath("guest");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL!).origin,
          localStorage: [{ name: GUEST_DISCLAIMER_ACK_KEY, value: new Date().toISOString() }],
        },
      ],
    })
  );
});
