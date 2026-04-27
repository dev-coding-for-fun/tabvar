import type { MetaDescriptor } from "react-router";

/** Canonical public app host for open graph, canonical links, and sharing. */
export const APP_ORIGIN = "https://app.tabvar.org" as const;

export const DEFAULT_SITE_DESCRIPTION =
  "TABVAR: climbing topos, routes, and the community issue workflow in Alberta.";

export function pageTitle(phrase: string): string {
  return `${phrase} · TABVAR`;
}

export function absoluteUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${APP_ORIGIN}${path}`;
}

function noindexMetas(): MetaDescriptor[] {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

/** Login, admin, and other pages that should not be indexed. */
export function privatePageMeta(phrase: string): MetaDescriptor[] {
  return [
    { title: pageTitle(phrase) },
    ...noindexMetas(),
  ];
}

export type PublicPageMetaArgs = {
  /** Shown before the ` · TABVAR` suffix. */
  titlePhrase: string;
  description: string;
  /** Pathname only, e.g. `/topos` (used for `og:url` and canonical). */
  pathname: string;
};

function canonicalLinkMeta(href: string): MetaDescriptor {
  return { tagName: "link", rel: "canonical", href };
}

export function publicPageMeta({
  titlePhrase,
  description,
  pathname,
}: PublicPageMetaArgs): MetaDescriptor[] {
  const fullTitle = pageTitle(titlePhrase);
  const url = absoluteUrl(pathname);
  return [
    { title: fullTitle },
    { name: "description", content: description },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    canonicalLinkMeta(url),
  ];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function cragMetaDescription(crag: { name: string; notes?: string | null }): string {
  if (crag.notes) {
    const t = stripHtml(crag.notes);
    if (t.length > 0) {
      return t.length > 160 ? `${t.slice(0, 157)}…` : t;
    }
  }
  return `Climbing topos, sectors, and routes for ${crag.name} in the TABVAR app.`;
}
