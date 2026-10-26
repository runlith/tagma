import { modelImageTokens } from '@runlith/llm/models/imageTokens';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentRequestFootprint } from '../../agent/AgentCallMeasurement';

export type ThreadTokenEstimate = {
  readonly measured: number;
  readonly covered: number;
  readonly estimated: number;
};

export type ThreadMeasuredRequest = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly footprint: AgentRequestFootprint;
};

export const RAW_CHARS_PER_TOKEN = 4;

export function estimateThreadTokens(value: unknown, imageTokens = 0): number {
  if (typeof value === 'string') return Math.max(0, Math.round(value.length / RAW_CHARS_PER_TOKEN));
  const weight = measure(value, imageTokens);
  return Math.max(0, Math.round(weight.chars / RAW_CHARS_PER_TOKEN) + weight.images);
}

export function estimateThreadTokenSuffixes(values: readonly Message[], imageTokens = 0): readonly number[] {
  const tokens = new Array<number>(values.length + 1);
  tokens[values.length] = 1;
  let chars = 1;
  let images = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const weight = measure(values[index], imageTokens);
    chars += weight.chars + 1;
    images += weight.images;
    tokens[index] = Math.max(0, Math.round(chars / RAW_CHARS_PER_TOKEN) + images);
  }
  return tokens;
}

export function estimateImageFreeTokens(value: unknown): number | null {
  if (typeof value === 'string') return estimateThreadTokens(value);
  const weight = measure(value, 0);
  return weight.imageParts > 0 ? null : Math.max(0, Math.round(weight.chars / RAW_CHARS_PER_TOKEN));
}

function measure(value: unknown, imageTokens: number): { readonly chars: number; readonly images: number; readonly imageParts: number } {
  let imageTokensTotal = 0;
  let imageParts = 0;
  let binaryChars = 0;
  const serialized = JSON.stringify(value, (key, item) => {
    if (key === PROVIDER_CARRY || key === MESSAGE_CARRY) return undefined;
    if (isImagePart(item)) {
      imageTokensTotal += estimateImagePartTokens(item, imageTokens);
      imageParts += 1;
      return EMPTY;
    }
    const bytes = binaryLength(item);
    if (bytes === null) return item;
    binaryChars += Math.ceil(bytes / 3) * 4;
    return EMPTY;
  });
  return { chars: (serialized?.length ?? 0) + binaryChars, images: imageTokensTotal, imageParts };
}

const EMPTY = '';

const PROVIDER_CARRY = 'providerMetadata';
const MESSAGE_CARRY = 'native';

export function estimateImagePartTokens(value: unknown, imageTokens = 0): number {
  return isImagePart(value) ? Math.max(imageTokens, modelImageTokens(imageMeasure(value))) : 0;
}

function imageMeasure(value: object): { size?: { width: number; height: number }; byteLength?: number } {
  const part = value as { type?: unknown; width?: unknown; height?: unknown; data?: unknown; uri?: unknown };
  const size = typeof part.width === 'number' && typeof part.height === 'number' ? { width: part.width, height: part.height } : undefined;
  const data = part.type === 'file' ? (typeof part.uri === 'string' && part.uri.startsWith('data:') ? part.uri : undefined) : part.data;
  const byteLength = typeof data === 'string' ? Math.ceil((data.length * 3) / 4) : (binaryLength(data) ?? undefined);
  return { size: size, byteLength: byteLength };
}

function isImagePart(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'media') {
    return 'mediaType' in value && typeof value.mediaType === 'string' && value.mediaType.startsWith('image/');
  }
  return value.type === 'file' && 'mime' in value && typeof value.mime === 'string' && value.mime.startsWith('image/');
}

function binaryLength(value: unknown): number | null {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return ArrayBuffer.isView(value) ? value.byteLength : null;
}
