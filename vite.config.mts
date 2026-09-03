import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vitest/config";
import { sentryReactRouter } from "@sentry/react-router";

const config = defineConfig(async (configEnv) => {
  const isTest = configEnv.mode === "test";

  return {
    server: {
      // IPv4 loopback so adb reverse (tcp:PORT tcp:PORT) can reach the dev server.
      host: "127.0.0.1",
    },
    plugins: [
      ...(!isTest ? [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter()] : []),
      ...(await sentryReactRouter({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "tabvar-k0",
        project: "tabvar-app",
      }, configEnv)),
    ],
  resolve: {
    tsconfigPaths: true,
  },
    ssr: {
      resolve: {
        conditions: ["worker", "workerd"],
      },
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
