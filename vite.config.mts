import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { defineConfig } from "vitest/config";
import { sentryReactRouter } from "@sentry/react-router";

const config = defineConfig(async (configEnv) => {
  const isTest = configEnv.mode === "test";

  return {
    plugins: [
      ...(!isTest ? [cloudflareDevProxy(), reactRouter()] : []),
      ...(await sentryReactRouter({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "tabvar-k0",
        project: "tabvar-app",
      }, configEnv)),
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
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "build", ".react-router", "dist"],
    coverage: {
      reporter: ["text", "html"],
      exclude: [
        "app/test/**",
        "**/*.test.{ts,tsx}",
        ".react-router/**",
        "build/**",
      ],
    },
  },
  };
});

export default config;
