/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { tryLoadAndStartRecorder } from '@alwaysmeticulous/recorder-loader'

function isProduction() {
  return window.location.hostname.indexOf("tabvar.pages.dev") > -1;
}

(async () => {
  /* if (!isProduction()) {
    await tryLoadAndStartRecorder({
      projectId: 'RkWghRBFYGTJoUm0HxHmIGxDv5fCNry68n4FiFw1',
      isProduction: false,
    });
  } */

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <RemixBrowser />
      </StrictMode>
    );
  });
})();
