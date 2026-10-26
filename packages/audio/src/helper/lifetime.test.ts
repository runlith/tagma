import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect';
import { AudioDevices, type Capabilities } from '../port/devices.ts';
import type { Format } from '../sound/format.ts';
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
const speech: Format = { rate: 16_000, channels: 1 };
const mic = { source: 'mic', echoCancel: false } as const;

const run = <A, E>(channel: FakeChannel, body: Effect.Effect<A, E, AudioDevices | Scope.Scope>, options: ClientOptions = {}) =>
  body.pipe(Effect.scoped, Effect.provide(helperClientLayer(capabilities, options).pipe(Layer.provide(channel.layer))));

const ending = (sounds: ReadonlyArray<Sound>) =>
  sounds.slice(-2).map((sound) => (sound._tag === 'Gap' ? sound.cause : sound._tag === 'Ended' ? sound.reason : 'chunk'));

describe('helper client lifetimes', () => {
  it.live('a failed write ends the session: tracks end, marks clear, writes refuse', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ drainPerMs: 0 });
      const [sounds, mark, write] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const track = yield* devices.capture(mic);
          const player = yield* devices.play(speech);
          const mark = yield* player.mark('pending');
          yield* channel.launched[0]!.pair.breakClientWrites;
          const write = yield* Effect.flip(player.write(new Int16Array(160)));
          return [yield* Stream.runCollect(track.chunks), yield* mark, write] as const;
        }),
      );
      expect(ending(sounds)).toEqual(['helper-failed', 'helper-lost']);
      expect(mark).toBe('cleared');
      expect(write.code).toBe('unavailable');
    }),
  );

  it.live('clear clears pending marks and returns the credit an interrupted write left queued', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ drainPerMs: 0 });
      const [mark, wrote] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const player = yield* devices.play(speech);
          const writing = yield* Effect.forkChild(player.write(new Int16Array(16_000)));
          yield* Effect.sleep(Duration.millis(5));
          yield* Fiber.interrupt(writing);
          const mark = yield* player.mark('pending');
          yield* player.clear;
          const outcome = yield* mark;
          yield* player.write(new Int16Array(3_200));
          yield* devices.devices;
          return [outcome, channel.launched[0]!.helper.framesOf(1)] as const;
        }),
        { queueMs: 200 },
      );
      expect(mark).toBe('cleared');
      expect(wrote).toBe(3_200 + 3_200);
    }),
  );

  it.live('releasing a player mid-write leaves the shared session running', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ drainPerMs: 5 });
      const [write, heard] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const track = yield* devices.capture(mic);
          const scope = yield* Scope.make();
          const player = yield* Scope.provide(devices.play(speech), scope);
          const writing = yield* Effect.forkChild(Effect.flip(player.write(new Int16Array(32_000))));
          yield* Effect.sleep(Duration.millis(5));
          yield* Scope.close(scope, Exit.void);
          const write = yield* Fiber.join(writing);
          yield* Effect.sleep(Duration.millis(5));
          return [write, yield* Stream.runCollect(Stream.take(track.chunks, 20))] as const;
        }),
        { queueMs: 100 },
      );
      expect(write.code).toBe('device-failed');
      expect(heard.every((sound) => sound._tag === 'Chunk')).toBe(true);
    }),
  );
});
