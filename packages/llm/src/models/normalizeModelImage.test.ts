import { beforeAll, expect, test } from 'bun:test';
import sharp from 'sharp';
import { MODEL_IMAGE_MAX_BASE64_BYTES, MODEL_IMAGE_MAX_WIDTH, normalizeModelImage } from './normalizeModelImage';

const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

const OVERSIZED_WIDTH = 2_004;
const OVERSIZED_HEIGHT = 3;
const REDUCED_HEIGHT = 3;
const NOISY_WIDTH = 1_400;
const NOISY_HEIGHT = 1_050;

type ImageSamples = { readonly small: Uint8Array; readonly animated: Uint8Array };
const samples = Promise.withResolvers<ImageSamples>();
beforeAll(async () => {
  samples.resolve({ small: await png(64, 64), animated: await animatedFrames() });
});

test('an image already under every ceiling comes back untouched', async () => {
  const bytes = (await samples.promise).small;

  const result = await normalizeModelImage({ mediaType: 'image/png', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(new Uint8Array(result.image.bytes)).toEqual(new Uint8Array(bytes));
  expect(result.image).toMatchObject({ mediaType: 'image/png', width: 64, height: 64 });
});

test('an oversized image is reduced onto the ceilings, keeping its aspect and its format', async () => {
  const bytes = await png(OVERSIZED_WIDTH, OVERSIZED_HEIGHT);

  const result = await normalizeModelImage({ mediaType: 'image/png', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.image).toMatchObject({
    mediaType: 'image/png',
    width: MODEL_IMAGE_MAX_WIDTH,
    height: REDUCED_HEIGHT,
    sourceWidth: OVERSIZED_WIDTH,
    sourceHeight: OVERSIZED_HEIGHT,
  });
  expect(Buffer.from(result.image.bytes).toString('base64').length).toBeLessThanOrEqual(MODEL_IMAGE_MAX_BASE64_BYTES);
});

test('an EXIF-oriented image comes out with the orientation applied to its pixels', async () => {
  const bytes = await orientedHalves(OVERSIZED_WIDTH, OVERSIZED_HEIGHT);

  const result = await normalizeModelImage({ mediaType: 'image/jpeg', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.image).toMatchObject({ mediaType: 'image/png', width: REDUCED_HEIGHT, height: MODEL_IMAGE_MAX_WIDTH });
  const output = await sharp(result.image.bytes).metadata();
  expect(output.width).toBe(REDUCED_HEIGHT);
  expect(output.height).toBe(MODEL_IMAGE_MAX_WIDTH);
  expect(output.orientation).toBeUndefined();
  const { data, info } = await sharp(result.image.bytes).raw().toBuffer({ resolveWithObject: true });
  for (const [x, y, expected] of [
    [1, 100, [200, 30, 30]],
    [1, 1900, [30, 30, 200]],
  ] as const) {
    const offset = (y * info.width + x) * info.channels;
    for (const [index, value] of expected.entries()) {
      expect(Math.abs(data.readUInt8(offset + index) - value)).toBeLessThan(64);
    }
  }
});

test('a rotated image passed through keeps its bytes and reports the dimensions it displays', async () => {
  const small = await orientedHalves(96, 64);

  const passed = await normalizeModelImage({ mediaType: 'image/jpeg', bytes: small, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(passed.status).toBe('ready');
  if (passed.status !== 'ready') return;
  expect(new Uint8Array(passed.image.bytes)).toEqual(new Uint8Array(small));
  expect(passed.image).toMatchObject({ mediaType: 'image/jpeg', width: 64, height: 96 });
});

test('an animated image reduces to its first frame as a still image', async () => {
  const bytes = (await samples.promise).animated;

  const result = await normalizeModelImage({ mediaType: 'image/gif', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.image).toMatchObject({
    mediaType: 'image/png',
    width: MODEL_IMAGE_MAX_WIDTH,
    height: REDUCED_HEIGHT,
  });
  const { data, info } = await sharp(result.image.bytes).raw().toBuffer({ resolveWithObject: true });
  const offset = (info.width + 1000) * info.channels;
  expect([data.readUInt8(offset), data.readUInt8(offset + 1), data.readUInt8(offset + 2)]).toEqual([255, 0, 0]);
});

test('the reduction keeps the highest JPEG quality that fits the byte ceiling', async () => {
  const bytes = await noisyPng(NOISY_WIDTH, NOISY_HEIGHT);
  expect(Buffer.from(bytes).toString('base64').length).toBeGreaterThan(MODEL_IMAGE_MAX_BASE64_BYTES);

  const result = await normalizeModelImage({ mediaType: 'image/png', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(result.image).toMatchObject({
    mediaType: 'image/jpeg',
    width: NOISY_WIDTH,
    height: NOISY_HEIGHT,
  });
  const quality85 = await sharp(Buffer.from(bytes), { autoOrient: true, pages: 1 })
    .resize(NOISY_WIDTH, NOISY_HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 85 })
    .toBuffer();
  expect(quality85.toString('base64').length).toBeLessThanOrEqual(MODEL_IMAGE_MAX_BASE64_BYTES);
  expect(Buffer.from(result.image.bytes).equals(quality85)).toBe(true);
});

test('bytes that do not match the declared media type are refused, not re-labelled', async () => {
  const bytes = await png(8, 8);

  const result = await normalizeModelImage({ mediaType: 'image/jpeg', bytes, maxSourceBytes: SOURCE_MAX_BYTES });

  expect(result).toEqual({ status: 'rejected', rejection: { reason: 'type-mismatch' } });
});

test('bytes that are not an image at all are refused as undecodable', async () => {
  const result = await normalizeModelImage({
    mediaType: 'image/png',
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    maxSourceBytes: SOURCE_MAX_BYTES,
  });

  expect(result).toEqual({ status: 'rejected', rejection: { reason: 'undecodable' } });
});

test('the source ceiling is the caller of the day, and empty is its own refusal', async () => {
  const bytes = (await samples.promise).small;

  await expect(normalizeModelImage({ mediaType: 'image/png', bytes, maxSourceBytes: 10 })).resolves.toEqual({
    status: 'rejected',
    rejection: { reason: 'too-large', maxSourceBytes: 10 },
  });

  await expect(normalizeModelImage({ mediaType: 'image/png', bytes: new Uint8Array(), maxSourceBytes: SOURCE_MAX_BYTES })).resolves.toEqual(
    { status: 'rejected', rejection: { reason: 'empty' } },
  );
});

function png(width: number, height: number): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

function noisyPng(width: number, height: number): Promise<Uint8Array> {
  const length = width * height * 3;
  const pixels = Buffer.alloc(Math.ceil(length / 4) * 4);
  let state = 0x5eeda11;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels.writeUInt32LE(state >>> 0, offset);
  }
  return sharp(pixels.subarray(0, length), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

function orientedHalves(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const left = x < width / 2;
      pixels[offset] = left ? 200 : 30;
      pixels[offset + 1] = 30;
      pixels[offset + 2] = left ? 30 : 200;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer()
    .then((flat) => sharp(flat).withMetadata({ orientation: 6 }).jpeg().toBuffer());
}

async function animatedFrames(): Promise<Uint8Array> {
  const frame = (background: { r: number; g: number; b: number }): Promise<Buffer> =>
    sharp({ create: { width: OVERSIZED_WIDTH, height: OVERSIZED_HEIGHT, channels: 3, background } })
      .gif({ effort: 1, dither: 0 })
      .toBuffer();
  const frames = await Promise.all([frame({ r: 255, g: 0, b: 0 }), frame({ r: 0, g: 0, b: 255 })]);
  return sharp(frames, { join: { animated: true } })
    .gif({ effort: 1, dither: 0 })
    .toBuffer();
}
