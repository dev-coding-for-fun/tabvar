import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { sentryVitePlugin } from "@sentry/vite-plugin";

declare module "@remix-run/cloudflare" {
  interface Future {
    v3_singleFetch: true;
  }
}

const config = defineConfig({
  plugins: [
    remixCloudflareDevProxy(), 
    remix({
      future: {
        unstable_optimizeDeps: true,
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      }
    }), 
    tsconfigPaths(),
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "tabvar-k0",
      project: "tabvar-app",
    }),
  ],
  resolve: {
    alias: {
      // Alias Node.js core modules to their prefixed versions
      'util': 'node:util',
      'buffer': 'node:buffer',
      'path': 'node:path',
      'stream': 'node:stream',
      'events': 'node:events',
      'crypto': 'node:crypto',
      // Add other necessary aliases here
    }
  },
  build: {
    sourcemap: true,
  },
});

export default config;