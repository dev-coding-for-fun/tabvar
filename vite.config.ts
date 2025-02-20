import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
  plugins: [remixCloudflareDevProxy(), remix(), tsconfigPaths()],
  build: {
    rollupOptions: {
      external: [
        'node:util',
        'node:buffer',
        'node:path',
        'node:stream',
        'node:events',
        'node:crypto',
      ]
    }
  },
});

export default config;