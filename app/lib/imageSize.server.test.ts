import { describe, expect, it } from "vitest";
import { createImageFile } from "~/test/helpers";
import { ImageSizeError, measureImage } from "./imageSize.server";

describe("measureImage", () => {
  it("reads the size of PNG and JPEG images", async () => {
    await expect(measureImage(createImageFile("a.png", { type: "image/png", width: 4032, height: 3024 })))
      .resolves.toEqual({ width: 4032, height: 3024 });
    await expect(measureImage(createImageFile("a.jpg", { width: 3024, height: 4032 })))
      .resolves.toEqual({ width: 3024, height: 4032 });
  });

  it("reports a JPEG's size as displayed after its EXIF orientation", async () => {
    // A phone photo stored landscape, tagged to display rotated a quarter turn.
    for (const orientation of [5, 6, 7, 8]) {
      await expect(measureImage(createImageFile("a.jpg", { width: 4032, height: 3024, orientation })))
        .resolves.toEqual({ width: 3024, height: 4032 });
    }
    for (const orientation of [1, 2, 3, 4]) {
      await expect(measureImage(createImageFile("a.jpg", { width: 4032, height: 3024, orientation })))
        .resolves.toEqual({ width: 4032, height: 3024 });
    }
  });

  it("refuses files that aren't images", async () => {
    await expect(measureImage(new File(["not an image"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(ImageSizeError);
    await expect(measureImage(new File(["not an image"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(/isn't a readable image/);
    await expect(measureImage(new File(["<svg width='10' height='10'></svg>"], "a.png", { type: "image/png" })))
      .rejects.toThrow("must be a JPEG, PNG, GIF, or WebP image, not svg");
  });
});
