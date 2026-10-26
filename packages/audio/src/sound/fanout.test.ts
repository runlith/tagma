import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { type Cause, Effect, Fiber, Queue, Stream } from 'effect';
import { chunk } from './chunk.ts';
import { captureFormat, nanosOf } from './format.ts';
import { fanout } from './fanout.ts';
import { ended, type Sound } from './track.ts';

const STEP = nanosOf(captureFormat, 320);

it.effect('a reader behind its window gets one overflow gap over exactly what it missed, while the reader keeping up gets everything', () =>
  Effect.gen(function* () {
    const sounds: Sound[] = [
      ...Array.from({ length: 6 }, (_, index) => chunk(captureFormat, BigInt(index) * STEP, new Int16Array(320))),
      ended('drained'),
    ];
    const source = yield* Queue.unbounded<Sound, Cause.Done>();
    const [first, second] = yield* fanout({ format: captureFormat, chunks: Stream.fromQueue(source), end: Effect.void }, 2, 50);
    const keeping = yield* Effect.forkChild(Stream.runCollect(first!.chunks));
    for (const sound of sounds) {
      yield* Queue.offer(source, sound);
      for (let turn = 0; turn < 4; turn++) yield* Effect.yieldNow;
    }
    yield* Queue.end(source);
    const eager = yield* Fiber.join(keeping);
    const late = yield* Stream.runCollect(second!.chunks);
    expect(eager).toEqual(sounds);
    expect(late.map((sound) => sound._tag)).toEqual(['Chunk', 'Chunk', 'Gap', 'Ended']);
    expect(late[2]).toEqual({ _tag: 'Gap', from: 2n * STEP, to: 6n * STEP, cause: 'overflow' });
  }),
);
