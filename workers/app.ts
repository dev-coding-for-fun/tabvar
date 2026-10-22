import { createRequestHandler, RouterContextProvider } from "react-router";
import * as build from "virtual:react-router/server-build";
import { getLegacyTopoResponse } from "../app/lib/workerRouting.server";

const requestHandler = createRequestHandler(build);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const legacyResponse = getLegacyTopoResponse(request);
    if (legacyResponse) return legacyResponse;

    if (request.method === "GET" || request.method === "HEAD") {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    const routerContext = new RouterContextProvider();
    Object.assign(routerContext, {
      cloudflare: {
        env,
        ctx: {
          waitUntil: ctx.waitUntil.bind(ctx),
          passThroughOnException: ctx.passThroughOnException.bind(ctx),
        },
        cf: (request as any).cf,
        caches,
      },
    });
    return requestHandler(request, routerContext);
  },
} satisfies ExportedHandler<Env>;
