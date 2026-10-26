const PIXELS_PER_TOKEN = 750;

const MAX_BILLED_PIXELS = 1_150_000;

const BYTES_PER_TOKEN = 750;

export type ModelImageSize = { readonly width: number; readonly height: number };

export function modelImageTokens(image: { readonly size?: ModelImageSize | undefined; readonly byteLength?: number | undefined }): number {
  const size = image.size;
  if (size && size.width > 0 && size.height > 0) {
    const pixels = Math.min(size.width * size.height, MAX_BILLED_PIXELS);
    return Math.max(1, Math.round(pixels / PIXELS_PER_TOKEN));
  }
  const bytes = image.byteLength ?? 0;
  return bytes > 0 ? Math.max(1, Math.round(bytes / BYTES_PER_TOKEN)) : 0;
}
