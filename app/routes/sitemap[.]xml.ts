import type { LoaderFunction } from "react-router";
import { getDB } from "~/lib/db";
import { absoluteUrl } from "~/lib/seo";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(pathname: string): string {
  return `  <url>\n    <loc>${escapeXml(absoluteUrl(pathname))}</loc>\n  </url>`;
}

export const loader: LoaderFunction = async ({ context }) => {
  const db = getDB(context);
  const crags = await db
    .selectFrom("crag")
    .select("slug")
    .where("slug", "is not", null)
    .orderBy("name", "asc")
    .execute();

  const urls = [
    urlEntry("/"),
    urlEntry("/topos"),
    ...crags
      .filter((crag): crag is { slug: string } => Boolean(crag.slug))
      .map((crag) => urlEntry(`/topos/${encodeURIComponent(crag.slug)}`)),
    urlEntry("/goldencrowbar"),
    urlEntry("/goldencrowbar/winner"),
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
