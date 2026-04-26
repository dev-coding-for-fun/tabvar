import type { LoaderFunction } from "@remix-run/cloudflare";
import { absoluteUrl } from "~/lib/seo";

export const loader: LoaderFunction = async () => {
  const robots = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
