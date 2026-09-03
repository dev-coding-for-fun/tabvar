import { createRequestHandler, RouterContextProvider } from "react-router";
import * as build from "virtual:react-router/server-build";

const requestHandler = createRequestHandler(build);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
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
