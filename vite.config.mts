import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { defineConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const config = defineConfig({
  plugins: [
    cloudflareDevProxy(),
    reactRouter(),
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "tabvar-k0",
      project: "tabvar-app",
    }),
  ],
  resolve: {
    tsconfigPaths: true,
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