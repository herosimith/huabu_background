const MIN_IMAGE_PIXELS = 655_360;
const MAX_IMAGE_PIXELS = 8_294_400;
const MAX_IMAGE_EDGE = 3_840;
const MAX_ASPECT_RATIO = 3;

export function imageSizeValidationError(size: string): string | undefined {
  if (size === "auto") return undefined;

  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return "size must be auto or WIDTHxHEIGHT";

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 16 !== 0 || height % 16 !== 0) {
    return "image width and height must both be multiples of 16";
  }
  if (Math.max(width, height) > MAX_IMAGE_EDGE) {
    return `image width and height must not exceed ${MAX_IMAGE_EDGE}px`;
  }

  const pixels = width * height;
  if (pixels < MIN_IMAGE_PIXELS || pixels > MAX_IMAGE_PIXELS) {
    return `image size must contain between ${MIN_IMAGE_PIXELS} and ${MAX_IMAGE_PIXELS} pixels`;
  }
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT_RATIO) {
    return `image aspect ratio must not exceed ${MAX_ASPECT_RATIO}:1`;
  }

  return undefined;
}
