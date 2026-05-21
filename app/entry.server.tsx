import { captureException } from "@sentry/cloudflare";
import { injectTraceMetaTags, wrapSentryHandleRequest } from "@sentry/react-router/cloudflare";
/**
 * By default, Remix will handle generating the HTTP Response for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.server
 */

import { ServerRouter, type AppLoadContext, type EntryContext } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";


async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  // This is ignored so we can keep it in the template for visibility.  Feel
  // free to delete this parameter in your app if you're not using it!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: AppLoadContext
) {
  
  const body = await renderToReadableStream(
    <ServerRouter context={remixContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error: unknown) {
        // Log streaming rendering errors from inside the shell
        console.error(error);
        responseStatusCode = 500;
      },
    }
  );

  if (isbot(request.headers.get("user-agent") || "")) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(injectTraceMetaTags(body), {
    headers: responseHeaders,
    status: responseStatusCode,
  });

}

export function handleError(error: unknown) {
  captureException(error);
}

export default wrapSentryHandleRequest(handleRequest);
