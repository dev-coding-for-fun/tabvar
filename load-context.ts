import { type PlatformProxy } from "wrangler";
import type { RouterContextProvider } from "react-router";

type Cloudflare = Omit<PlatformProxy<Env>, "dispose">;

declare module "react-router" {
  interface RouterContextProvider {
    cloudflare: Cloudflare;
  }
  export type AppLoadContext = Readonly<RouterContextProvider>;
  export const AppLoadContext: typeof RouterContextProvider;
}

export type AppLoadContext = Readonly<RouterContextProvider>;
export const AppLoadContext = undefined as unknown as typeof RouterContextProvider;