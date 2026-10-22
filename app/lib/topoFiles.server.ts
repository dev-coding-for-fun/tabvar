import { sql } from "kysely";
import type { AppLoadContext } from "react-router";
import { chunk, MAX_IDS_PER_QUERY } from "./audit.server";
import { getDB } from "./db";
import { deleteFromR2 } from "./s3.server";

/**
 * Topo images are stored once per content hash: backgrounds under
 * `topos/raw/<sha1>.<ext>`, rasters under `topos/raster/<sha1>.<ext>`, whoever
 * sends them. Old backgrounds are kept as an archive. A raster is rendered from
 * its background and annotations, so one nothing uses is deleted.
 */
export const BACKGROUND_KEY_PREFIX = "topos/raw";
export const RASTER_KEY_PREFIX = "topos/raster";

/** The SHA-1 a content-hashed image URL is named by, or null for any other URL. */
export function hashFromUrl(url: string | null | undefined): string | null {
  const match = url?.match(/\/([0-9a-f]{40})(?:\.[a-z0-9]+)?$/i);
  return match ? match[1].toLowerCase() : null;
}

const jsonField = (field: "background" | "raster") => sql<string | null>`json_extract(fields, ${`$.${field}`})`;

/**
 * Deletes the given content-hashed topo images unless a topo or a pending
 * proposal still uses them. Run it after the writes that stopped using them.
 * Failures are logged rather than thrown: the writes already succeeded, and a
 * file left behind is only a stray copy.
 */
export async function removeUnusedTopoFiles(context: AppLoadContext, urls: Iterable<string | null | undefined>) {
  const env = context.cloudflare.env as unknown as Env;
  const prefix = `${env.TOPOS_BUCKET_DOMAIN}/`;
  const candidates = [...new Set(urls)].filter((url): url is string =>
    typeof url === "string" && url.startsWith(prefix) && hashFromUrl(url) !== null);
  if (candidates.length === 0) return;

  const db = getDB(context);
  const inUse = new Set<string>();
  try {
    // Each query binds the chunk twice.
    for (const urlChunk of chunk(candidates, MAX_IDS_PER_QUERY / 2)) {
      const topos = await db.selectFrom("topo")
        .select(["background_image_url", "raster_image_url"])
        .where((eb) => eb.or([eb("background_image_url", "in", urlChunk), eb("raster_image_url", "in", urlChunk)]))
        .execute();
      topos.forEach((row) => inUse.add(row.background_image_url).add(row.raster_image_url));

      const proposals = await db.selectFrom("submission")
        .select([jsonField("background").as("background"), jsonField("raster").as("raster")])
        .where("state", "=", "pending")
        .where("entity", "=", "topo")
        .where((eb) => eb.or([eb(jsonField("background"), "in", urlChunk), eb(jsonField("raster"), "in", urlChunk)]))
        .execute();
      proposals.forEach((row) => [row.background, row.raster].forEach((url) => url && inUse.add(url)));
    }
  } catch (error) {
    console.error("Couldn't check which topo images are still in use:", error);
    return;
  }

  const results = await Promise.allSettled(
    candidates
      .filter((url) => !inUse.has(url))
      .map((url) => deleteFromR2(context, env.TOPOS_BUCKET_NAME, url.slice(prefix.length).split("/").map(decodeURIComponent).join("/"))),
  );
  results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .forEach((result) => console.error("Failed to delete an unused topo image:", result.reason));
}
