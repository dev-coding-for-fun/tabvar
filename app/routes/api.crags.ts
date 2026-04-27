import { LoaderFunction } from "react-router";
import { getDB } from "~/lib/db";

export const loader: LoaderFunction = async ({ context }) => {
  const db = getDB(context);
  const crags = await db
    .selectFrom("crag")
    .select(["id", "name"])
    .orderBy("name", "asc")
    .execute();

  return crags;
}; 