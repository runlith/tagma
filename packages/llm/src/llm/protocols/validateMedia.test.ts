import { expect } from 'bun:test';
import { Buffer } from 'node:buffer';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit } from 'effect';
import type { MediaPart } from '../schema/messages';
import * as ProviderShared from './shared';

const IMAGES = new Set<string>(ProviderShared.IMAGE_MIMES);

const validation = (data: MediaPart['data'], mediaType = 'image/png') =>
  ProviderShared.validateMedia('Route', { type: 'media', mediaType, data }, IMAGES);

const validate = (data: MediaPart['data'], mediaType = 'image/png') => Effect.exit(validation(data, mediaType));

const refusal = Effect.fnUntraced(function* (data: MediaPart['data'], mediaType?: string) {
  const exit = yield* validate(data, mediaType);
  if (!Exit.isFailure(exit)) return yield* Effect.die('expected a refusal');
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag !== 'Some') return yield* Effect.die('expected a typed failure');
  return error.value.reason._tag === 'InvalidRequest' ? error.value.reason.message : error.value.reason._tag;
});

const accepted = Effect.fnUntraced(function* (data: MediaPart['data']) {
  const exit = yield* validate(data);
  if (Exit.isFailure(exit)) return yield* Effect.die(`expected an answer: ${Cause.pretty(exit.cause)}`);
  return exit.value;
});

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64');

it.effect('canonical base64, a data URL and raw bytes all validate to the same media', () =>
  Effect.gen(function* () {
    const fromBase64 = yield* accepted(png);
    expect(fromBase64.base64).toBe(png);
    expect(fromBase64.dataUrl).toBe(`data:image/png;base64,${png}`);
    expect((yield* accepted(`data:image/png;base64,${png}`)).base64).toBe(png);
    expect(yield* accepted(Buffer.from(png, 'base64'))).toMatchObject({ base64: png });
  }),
);

it.effect('every malformed payload is still refused', () =>
  Effect.gen(function* () {
    expect(yield* refusal('')).toContain('must contain valid base64');
    expect(yield* refusal('AAA')).toContain('must contain valid base64');
    expect(yield* refusal('A A A A ')).toContain('must contain canonical base64');
    expect(yield* refusal('a!b=')).toContain('must contain canonical base64');
    expect(yield* refusal('-_-_')).toContain('must contain canonical base64');
    expect(yield* refusal('AA=ABBBB')).toContain('must contain canonical base64');
    expect(yield* refusal('AB==')).toContain('must contain canonical base64');
  }),
);

it.effect(
  'a seeded corpus of valid, !-broken and URL-alphabet payloads at every length and break position proves the data-URL payload through the real validator',
  () =>
    Effect.gen(function* () {
      const seed = 0x5eeda11;
      let random = seed;
      const randomBytes = (length: number) => {
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index++) {
          random ^= random << 13;
          random ^= random >>> 17;
          random ^= random << 5;
          random >>>= 0;
          bytes[index] = random & 0xff;
        }
        return bytes;
      };
      const cases: Array<{ readonly payload: string; readonly accepted: boolean }> = [
        { payload: '', accepted: false },
        { payload: 'A', accepted: false },
        { payload: 'AB', accepted: false },
        { payload: 'ABC', accepted: false },
        { payload: 'AAAA', accepted: true },
        { payload: '-_-_', accepted: false },
        { payload: 'a!b=', accepted: false },
        { payload: 'A A A A ', accepted: false },
        { payload: 'AA=ABBBB', accepted: false },
        { payload: 'AB==', accepted: false },
        { payload: 'AAA=', accepted: true },
        { payload: 'AA==', accepted: true },
        { payload: '////', accepted: true },
        { payload: '++++', accepted: true },
        { payload: 'AAAA=', accepted: false },
        { payload: 'AAAAAA==', accepted: true },
        { payload: '\u0000AAA', accepted: false },
        { payload: 'AAAA\n', accepted: false },
        { payload: 'QUJD', accepted: true },
        { payload: 'QQ==', accepted: true },
        { payload: '%%%%', accepted: false },
        { payload: 'AAA/', accepted: true },
        { payload: 'AA/=', accepted: false },
        { payload: 'AAAA-BCD', accepted: false },
      ];

      const PER_FAMILY = 600;
      for (let index = 0; index < PER_FAMILY; index++)
        cases.push({ payload: Buffer.from(randomBytes(1 + (index % 40))).toString('base64'), accepted: true });
      for (let index = 0; index < PER_FAMILY; index++) {
        const payload = Buffer.from(randomBytes(4 + (index % 40))).toString('base64');
        const at = index % payload.length;
        cases.push({ payload: `${payload.slice(0, at)}!${payload.slice(at + 1)}`, accepted: false });
      }
      for (let index = 0; index < PER_FAMILY; index++) {
        const payload = Buffer.from(randomBytes(4 + (index % 40))).toString('base64');
        const at = index % payload.length;
        cases.push({ payload: `${payload.slice(0, at)}-${payload.slice(at + 1)}`, accepted: false });
      }

      let acceptedCount = 0;
      for (const [index, entry] of cases.entries()) {
        const actual = Exit.isSuccess(yield* validate(`data:image/png;base64,${entry.payload}`));
        if (actual !== entry.accepted)
          return yield* Effect.die(
            `seed ${seed.toString(16)} case ${index} expected ${entry.accepted ? 'accept' : 'refuse'} for ${JSON.stringify(entry.payload)}`,
          );
        if (actual) acceptedCount++;
      }
      expect(cases).toHaveLength(24 + 3 * PER_FAMILY);
      expect(acceptedCount).toBe(9 + PER_FAMILY);
    }),
);

it.effect('a MIME the route does not support and a malformed data-URL header are refused', () =>
  Effect.gen(function* () {
    expect(yield* refusal(png, 'video/mp4')).toContain('does not support media type video/mp4');
    expect(yield* refusal(`data:image/jpeg;base64,${png}`, 'image/png')).toContain('does not match data URL type');
    expect(yield* refusal('data:image/png;base64,')).toContain('must contain valid base64');
    for (const data of [
      'data:image/png;base64',
      `data:;base64,${png}`,
      `data:image/png,${png}`,
      `data:image/png;other;base64,${png}`,
      `data:image/png,other;base64,${png}`,
    ])
      expect(yield* refusal(data)).toContain('data URL must contain valid base64');
  }),
);

it.effect('a payload past the encoded ceiling is refused before it is decoded', () =>
  Effect.gen(function* () {
    const huge = 'A'.repeat(4 * (ProviderShared.MAX_MEDIA_ENCODED_BYTES / 4 + 4));
    expect(yield* refusal(huge)).toContain('byte encoded limit');
  }),
);
