import { describe, expect, it } from "vitest";
import { createMockDb } from "~/test/helpers";
import { slugify, slugifyUnique } from "./slug";

describe("slugify", () => {
  it.each([
    ["Ace of Spades", "ace-of-spades"],
    ["Café & Crag", "cafe-and-crag"],
    ["!!!", "crag"],
  ])("converts %s to %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("limits slugs to 80 characters without trailing hyphens", () => {
    const slug = slugify(`${"a".repeat(90)} !!!`);

    expect(slug).toHaveLength(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugifyUnique", () => {
  it("returns the base slug when it is available", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });

    await expect(slugifyUnique(db, "New Crag")).resolves.toBe("new-crag");
    expect(db.__queries[0].where).toHaveBeenCalledWith("slug", "=", "new-crag");
  });

  it("adds numeric suffixes until a slug is available", async () => {
    const db = createMockDb({
      select: [
        { executeTakeFirst: { id: 1 } },
        { executeTakeFirst: { id: 2 } },
        { executeTakeFirst: undefined },
      ],
    });

    await expect(slugifyUnique(db, "New Crag")).resolves.toBe("new-crag-3");
  });

  it("excludes an existing crag id when checking uniqueness", async () => {
    const db = createMockDb({ select: [{ executeTakeFirst: undefined }] });

    await slugifyUnique(db, "Existing Crag", 99);

    expect(db.__queries[0].$if).toHaveBeenCalledWith(true, expect.any(Function));
    expect(db.__queries[0].where).toHaveBeenCalledWith("id", "!=", 99);
  });
});
