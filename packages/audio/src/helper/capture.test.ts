import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { AudioDevices, type Capabilities } from '../port/devices.ts';
import type { Chunk } from '../sound/chunk.ts';
import { captureFormat, nanosOf } from '../sound/format.ts';
import type { Sound } from '../sound/track.ts';
import { type FakeChannel, fakeChannel } from '../testing/channel.ts';
import { type ClientOptions, helperClientLayer } from './client.ts';

const capabilities: Capabilities = {
  mic: true,
  system: true,
  excludeSelf: true,
  echoCancel: true,
  muteOutput: true,
  permissionPrompt: true,
};
const mic = { source: 'mic', echoCancel: false } as const;

const run = <A, E>(channel: FakeChannel, body: Effect.Effect<A, E, AudioDevices | Scope.Scope>, options: ClientOptions = {}) =>
  body.pipe(Effect.scoped, Effect.provide(helperClientLayer(capabilities, options).pipe(Layer.provide(channel.layer))));

const end = (part: Chunk): bigint => part.at + nanosOf(captureFormat, part.pcm.length);

describe('helper client captures', () => {
  it.live('a consumer behind the buffer gets one overflow gap covering exactly the dropped audio', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ pace: Duration.millis(1) });
      const sounds = yield* run(
        channel,
        Effect.gen(function* () {
          const track = yield* (yield* AudioDevices).capture(mic);
          yield* Effect.sleep(Duration.millis(200));
          return yield* Stream.runCollect(Stream.take(track.chunks, 7));
        }),
        { bufferMs: 100 },
      );
      const chunks = sounds.slice(0, 5) as ReadonlyArray<Chunk>;
      const overflow = sounds[5]!;
      const next = sounds[6]!;
      expect(sounds.map((sound) => sound._tag)).toEqual(['Chunk', 'Chunk', 'Chunk', 'Chunk', 'Chunk', 'Gap', 'Chunk']);
      expect(overflow).toMatchObject({ cause: 'overflow', from: end(chunks[4]!) });
      expect(overflow._tag === 'Gap' && next._tag === 'Chunk' && overflow.to === next.at).toBe(true);
    }),
  );

  it.live('closing a capture scope drops the audio it buffered', () =>
    Effect.gen(function* () {
      const channel = fakeChannel();
      const after = yield* run(
        channel,
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const track = yield* Scope.provide((yield* AudioDevices).capture(mic), scope);
          yield* Effect.sleep(Duration.millis(20));
          yield* Scope.close(scope, Exit.void);
          return yield* Stream.runCollect(track.chunks);
        }),
      );
      expect(after).toEqual([]);
    }),
  );

  it.live('a reversed gap from the helper is a protocol violation that ends the track', () =>
    Effect.gen(function* () {
      const channel = fakeChannel();
      const sounds = yield* run(
        channel,
        Effect.gen(function* () {
          const track = yield* (yield* AudioDevices).capture(mic);
          yield* channel.launched[0]!.helper.send({ type: 'gap', id: 1, fromNs: 10n, toNs: 5n, cause: 'overflow' });
          return yield* Stream.runCollect(track.chunks);
        }),
      );
      expect(sounds.at(-1)).toEqual({ _tag: 'Ended', reason: 'helper-lost' });
      expect(sounds.some((sound: Sound) => sound._tag === 'Gap' && sound.cause === 'overflow')).toBe(false);
    }),
  );

  it.live('the inventory round-trips and a mute holder is released with its scope', () =>
    Effect.gen(function* () {
      const channel = fakeChannel();
      const [inventory, held, released] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const inventory = yield* devices.devices;
          const scope = yield* Scope.make();
          yield* Scope.provide(devices.mute, scope);
          const held = channel.launched[0]!.helper.holders.size;
          yield* Scope.close(scope, Exit.void);
          yield* devices.devices;
          return [inventory, held, channel.launched[0]!.helper.holders.size] as const;
        }),
      );
      expect(inventory).toEqual({
        inputs: [
          { id: 'synthetic', label: 'Synthetic synthetic' },
          { id: 'synthetic-gap', label: 'Synthetic synthetic-gap' },
        ],
        permissions: { mic: 'granted', system: 'unknown' },
      });
      expect([held, released]).toEqual([1, 0]);
    }),
  );
});
