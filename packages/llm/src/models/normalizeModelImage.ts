import type Sharp from 'sharp';

export const MODEL_IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024;
export const MODEL_IMAGE_MAX_WIDTH = 2_000;
export const MODEL_IMAGE_MAX_HEIGHT = 2_000;
const JPEG_QUALITIES = [85, 80, 70, 55, 40] as const;

export const MODEL_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ModelImageMediaType = (typeof MODEL_IMAGE_MEDIA_TYPES)[number];

export type NormalizedImage = {
  mediaType: ModelImageMediaType;
  bytes: Uint8Array;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type ModelImageRejection =
  | { reason: 'empty' }
  | { reason: 'too-large'; maxSourceBytes: number }
  | { reason: 'undecodable' }
  | { reason: 'type-mismatch' }
  | { reason: 'irreducible'; maxWidth: number; maxHeight: number; maxBase64Bytes: number };

export type NormalizedImageResult = { status: 'ready'; image: NormalizedImage } | { status: 'rejected'; rejection: ModelImageRejection };

export async function normalizeModelImage(
  input: { mediaType: ModelImageMediaType; bytes: Uint8Array; maxSourceBytes: number },
  signal?: AbortSignal,
): Promise<NormalizedImageResult> {
  signal?.throwIfAborted();
  if (input.bytes.byteLength === 0) return { status: 'rejected', rejection: { reason: 'empty' } };
  if (input.bytes.byteLength > input.maxSourceBytes) {
    return { status: 'rejected', rejection: { reason: 'too-large', maxSourceBytes: input.maxSourceBytes } };
  }

  const { default: sharp } = await import('sharp');
  const bytes = Buffer.from(input.bytes);
  let metadata: Awaited<ReturnType<ReturnType<typeof Sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return { status: 'rejected', rejection: { reason: 'undecodable' } };
  }
  signal?.throwIfAborted();
  const expectedFormat = input.mediaType === 'image/jpeg' ? 'jpeg' : input.mediaType.slice('image/'.length);
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    return { status: 'rejected', rejection: { reason: 'type-mismatch' } };
  }

  const oriented = metadata.autoOrient;
  const source = { sourceWidth: oriented.width, sourceHeight: oriented.height };
  if (metadata.width <= MODEL_IMAGE_MAX_WIDTH && metadata.height <= MODEL_IMAGE_MAX_HEIGHT && fitsBase64(bytes)) {
    return {
      status: 'ready',
      image: { mediaType: input.mediaType, bytes, width: oriented.width, height: oriented.height, ...source },
    };
  }

  const scale = Math.min(1, MODEL_IMAGE_MAX_WIDTH / oriented.width, MODEL_IMAGE_MAX_HEIGHT / oriented.height);
  let width = Math.max(1, Math.round(oriented.width * scale));
  let height = Math.max(1, Math.round(oriented.height * scale));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    signal?.throwIfAborted();
    const resized = sharp(bytes, { autoOrient: true, pages: 1 }).resize(width, height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    });
    const png = await resized.clone().png().toBuffer();
    signal?.throwIfAborted();
    if (fitsBase64(png)) {
      return { status: 'ready', image: { mediaType: 'image/png', bytes: png, width, height, ...source } };
    }
    for (const quality of JPEG_QUALITIES) {
      const jpeg = await resized.clone().jpeg({ quality }).toBuffer();
      signal?.throwIfAborted();
      if (fitsBase64(jpeg)) {
        return { status: 'ready', image: { mediaType: 'image/jpeg', bytes: jpeg, width, height, ...source } };
      }
    }
    const nextWidth = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75));
    const nextHeight = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75));
    if (nextWidth === width && nextHeight === height) break;
    width = nextWidth;
    height = nextHeight;
  }

  return {
    status: 'rejected',
    rejection: {
      reason: 'irreducible',
      maxWidth: MODEL_IMAGE_MAX_WIDTH,
      maxHeight: MODEL_IMAGE_MAX_HEIGHT,
      maxBase64Bytes: MODEL_IMAGE_MAX_BASE64_BYTES,
    },
  };
}

export async function pictureSize(bytes: Uint8Array): Promise<{ readonly width: number; readonly height: number } | null> {
  const { default: sharp } = await import('sharp');
  try {
    const { autoOrient } = await sharp(Buffer.from(bytes)).metadata();
    return autoOrient.width > 0 && autoOrient.height > 0 ? { width: autoOrient.width, height: autoOrient.height } : null;
  } catch {
    return null;
  }
}

function fitsBase64(bytes: Uint8Array): boolean {
  return Math.ceil(bytes.byteLength / 3) * 4 <= MODEL_IMAGE_MAX_BASE64_BYTES;
}
