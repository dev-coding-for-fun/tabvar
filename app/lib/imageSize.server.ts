import { imageSize } from "image-size";

export type ImageSize = { width: number; height: number };

export class ImageSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageSizeError";
  }
}

// image-size's names for the formats in IMAGE_TYPES.
const MEASURABLE_TYPES = new Set(["jpg", "png", "gif", "webp"]);

/** Measures an uploaded image from its own header. Topo annotations are placed relative to the background's size. */
export async function measureImage(file: Blob): Promise<ImageSize> {
  let size;
  try {
    size = imageSize(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    throw new ImageSizeError(`isn't a readable image (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!size.type || !MEASURABLE_TYPES.has(size.type)) {
    throw new ImageSizeError(`must be a JPEG, PNG, GIF, or WebP image, not ${size.type ?? "an unknown format"}`);
  }
  if (!(size.width > 0 && size.height > 0)) {
    throw new ImageSizeError("has no width or height");
  }
  return { width: size.width, height: size.height };
}
