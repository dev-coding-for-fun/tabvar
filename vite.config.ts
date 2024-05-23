import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

const config = defineConfig({
  plugins: [remixCloudflareDevProxy(), remix(), react(), tsconfigPaths()],
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
  }
});

export default config;