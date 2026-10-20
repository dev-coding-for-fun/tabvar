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

// EXIF orientations 5–8 rotate the image a quarter turn, so it displays with width and height swapped.
const QUARTER_TURN_ORIENTATIONS = new Set([5, 6, 7, 8]);

/**
 * Measures an uploaded image from its own header, as it displays: browsers and
 * the app apply a JPEG's EXIF orientation, and topo annotations are placed
 * relative to the background as displayed.
 */
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
  return size.orientation !== undefined && QUARTER_TURN_ORIENTATIONS.has(size.orientation)
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}
