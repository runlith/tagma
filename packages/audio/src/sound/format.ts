import { Schema } from 'effect';

export const Format = Schema.Struct({
  rate: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 384_000 })),
  channels: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
});
export type Format = Schema.Schema.Type<typeof Format>;

export const captureFormat: Format = { rate: 16_000, channels: 1 };

export const framesOf = (format: Format, pcm: Int16Array): number => pcm.length / format.channels;

export const isWhole = (format: Format, pcm: Int16Array): boolean => pcm.length % format.channels === 0;

export const nanosOf = (format: Format, frames: number): bigint => BigInt(Math.round((frames * 1_000_000_000) / format.rate));

export const millisOf = (format: Format, frames: number): number => (frames * 1000) / format.rate;
