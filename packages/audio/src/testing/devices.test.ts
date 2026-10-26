import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Fiber, Scope, Stream } from 'effect';
import { AudioDevices } from '../port/devices.ts';
import { chunk } from '../sound/chunk.ts';
import { captureFormat } from '../sound/format.ts';
import { makeFakeDevices } from './devices.ts';

const live = Stream.concat(Stream.make(chunk(captureFormat, 0n, new Int16Array(320))), Stream.never);
const tail = chunk(captureFormat, 20_000_000n, new Int16Array(160));

const read = Effect.fnUntraced(function* (close: 'end' | 'scope') {
  const devices = yield* AudioDevices;
  const scope = yield* Scope.fork(yield* Effect.scope);
  const track = yield* Scope.provide(devices.capture({ source: 'mic', echoCancel: false }), scope);
  const reading = yield* Effect.forkChild(Stream.runCollect(track.chunks));
  yield* Effect.yieldNow;
  yield* close === 'end' ? track.end : Scope.close(scope, Exit.void);
  return (yield* Fiber.join(reading)).map((sound) => (sound._tag === 'Ended' ? sound.reason : sound._tag));
});

describe('fake devices', () => {
  it.effect('releasing a capture records abortion even after its reader has been interrupted', () =>
    Effect.gen(function* () {
      const fake = makeFakeDevices({ capture: () => ({ sounds: live }) });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const devices = yield* AudioDevices;
          const track = yield* devices.capture({ source: 'mic', echoCancel: false });
          const reading = yield* Effect.forkChild(Stream.runDrain(track.chunks));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(reading);
        }),
      ).pipe(Effect.provide(fake.layer));
      expect(fake.captures.map((record) => record.outcome)).toEqual(['aborted']);
    }),
  );

  it.effect('a live scripted capture stops on end with its tail and on scope close without it', () =>
    Effect.gen(function* () {
      const fake = makeFakeDevices({ capture: () => ({ sounds: live, tail: [tail] }) });
      const [drained, aborted] = yield* Effect.all([read('end'), read('scope')]).pipe(Effect.provide(fake.layer));
      expect(drained).toEqual(['Chunk', 'Chunk', 'drained']);
      expect(aborted).toEqual(['Chunk', 'aborted']);
    }),
  );
});
