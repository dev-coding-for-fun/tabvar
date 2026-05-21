import type { Kysely } from "kysely";
import type { DB } from "./db.d";

const MAX_SLUG_LENGTH = 80;

type SlugLookupDb = Pick<Kysely<DB>, "selectFrom">;

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/g, "");

  return slug || "crag";
}

export async function slugifyUnique(
  db: SlugLookupDb,
  value: string,
  excludeId?: number
): Promise<string> {
  const baseSlug = slugify(value);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await db
      .selectFrom("crag")
      .select("id")
      .where("slug", "=", candidate)
      .$if(excludeId !== undefined, (qb) => qb.where("id", "!=", excludeId!))
      .executeTakeFirst();

    if (!existing) {
      return candidate;
    }

    const suffixText = `-${suffix}`;
    candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
}
