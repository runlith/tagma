import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { AudioDevices, type Capabilities } from '../port/devices.ts';
import { rebuildHost } from '../port/refusal.ts';
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

const run = <A, E>(channel: FakeChannel, body: Effect.Effect<A, E, AudioDevices | Scope.Scope>, options: ClientOptions = {}) =>
  body.pipe(Effect.scoped, Effect.provide(helperClientLayer(capabilities, options).pipe(Layer.provide(channel.layer))));

const tags = (sounds: ReadonlyArray<Sound>): ReadonlyArray<string> => sounds.map((sound) => sound._tag);

describe('helper client', () => {
  it.live('hello translates helper time into this process clock', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ skew: 5_000_000_000_000n });
      const [first, now] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const track = yield* devices.capture({ source: 'mic', echoCancel: false });
          const sounds = yield* Stream.runCollect(Stream.take(track.chunks, 1));
          return [sounds[0]!, yield* Clock.monotonicTimeNanos] as const;
        }),
      );
      expect(first._tag).toBe('Chunk');
      const lag = first._tag === 'Chunk' ? now - first.at : 5_000_000_000_000n;
      expect(lag > -1_000_000_000n && lag < 1_000_000_000n).toBe(true);
    }),
  );

  it.live('write waits for credit and plays a reply longer than the queue', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ drainPerMs: 100 });
      const outcome = yield* run(
        channel,
        Effect.gen(function* () {
          const player = yield* (yield* AudioDevices).play(speech);
          yield* player.write(new Int16Array(48_000));
          return yield* yield* player.mark('done');
        }),
        { queueMs: 200 },
      );
      expect(outcome).toBe('played');
      expect(channel.launched[0]!.helper.framesOf(1)).toBe(48_000);
      expect(channel.launched[0]!.helper.maxQueuedMs).toBeLessThanOrEqual(300);
    }),
  );

  it.live('aborting one capture and releasing one player leave the others running', () =>
    Effect.gen(function* () {
      const channel = fakeChannel();
      const [heard, outcome, rest] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const first = yield* Scope.make();
          yield* Scope.provide(devices.capture({ source: 'mic', echoCancel: false }), first);
          const second = yield* devices.capture({ source: 'system', echoCancel: false });
          const released = yield* Scope.make();
          yield* Scope.provide(devices.play(speech), released);
          const kept = yield* devices.play(speech);
          yield* Scope.close(first, Exit.void);
          yield* Scope.close(released, Exit.void);
          const heard = yield* Stream.runCollect(Stream.take(second.chunks, 3));
          yield* kept.write(new Int16Array(1_600));
          const outcome = yield* yield* kept.mark('kept');
          yield* second.end;
          return [heard, outcome, yield* Stream.runCollect(second.chunks)] as const;
        }),
      );
      expect(tags(heard)).toEqual(['Chunk', 'Chunk', 'Chunk']);
      expect(outcome).toBe('played');
      expect(rest.at(-1)).toEqual({ _tag: 'Ended', reason: 'drained' });
    }),
  );

  it.live('the helper closing its channel gaps and ends every track and clears every mark', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ drainPerMs: 0 });
      const [one, two, mark, write] = yield* run(
        channel,
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const one = yield* devices.capture({ source: 'mic', echoCancel: false });
          const two = yield* devices.capture({ source: 'system', echoCancel: false });
          const player = yield* devices.play(speech);
          yield* player.write(new Int16Array(160));
          const mark = yield* player.mark('pending');
          yield* Stream.runCollect(Stream.take(one.chunks, 1));
          yield* channel.launched[0]!.helper.close;
          return [
            yield* Stream.runCollect(one.chunks),
            yield* Stream.runCollect(two.chunks),
            yield* mark,
            yield* Effect.flip(player.write(new Int16Array(160))),
          ] as const;
        }),
      );
      for (const sounds of [one, two]) {
        const [gap, ended] = sounds.slice(-2);
        expect(gap).toMatchObject({ _tag: 'Gap', to: undefined, cause: 'helper-failed' });
        expect(ended).toEqual({ _tag: 'Ended', reason: 'helper-lost' });
      }
      expect(mark).toBe('cleared');
      expect(write.code).toBe('unavailable');
    }),
  );

  it.live('a message outside the protocol refuses with helper-mismatch', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({ devicesReply: { type: 'devices', list: [], permissions: { mic: 'granted' } } });
      const refused = yield* run(
        channel,
        Effect.gen(function* () {
          return yield* Effect.flip((yield* AudioDevices).devices);
        }),
      );
      expect(refused.code).toBe('helper-mismatch');
      expect(refused.unblock).toEqual([rebuildHost]);
    }),
  );

  it.live('a hello with a foreign token is refused', () =>
    Effect.gen(function* () {
      const channel = fakeChannel({}, () => 'foreign');
      const refused = yield* run(
        channel,
        Effect.gen(function* () {
          return yield* Effect.flip((yield* AudioDevices).capture({ source: 'mic', echoCancel: false }));
        }),
      );
      expect(refused.code).toBe('unavailable');
    }),
  );
});
