import { init, browserTracingIntegration } from "@sentry/remix";
/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import { RemixBrowser, useLocation, useMatches } from "@remix-run/react";
import { startTransition, StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";

// Function to determine environment client-side
function getClientEnvironment() {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'development';
  } else if (hostname.includes('dev.') || hostname.includes('preview.')) {
    return 'preview';
  } else {
    return 'production';
  }
}

init({
    dsn: "https://73b48c35d2dc3946041ac5ebefafbbda@o4509392494723072.ingest.us.sentry.io/4509392495902720",
    tracesSampleRate: 1,
    environment: getClientEnvironment(), // Add environment tag
    integrations: [browserTracingIntegration({
      useEffect,
      useLocation,
      useMatches
    })]
});

(async () => {

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <RemixBrowser />
      </StrictMode>
    );
  });
})();