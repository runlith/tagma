import { gcAndSweep, heapStats } from 'bun:jsc';
import { Effect, Queue, Stream } from 'effect';
import { WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import { snapshotFeed } from './snapshotFeed.js';

type Event = { readonly index: number; readonly text: string };
type Frame = { readonly type: 'snapshot'; readonly through: number } | { readonly type: 'event'; readonly event: Event };
const counts = [25_000, 50_000];

function heap() {
  gcAndSweep();
  gcAndSweep();
  return { bytes: process.memoryUsage().heapUsed, objects: heapStats().objectCount };
}

async function sample(bounded: boolean, count: number) {
  let listener: ((event: Event) => void) | undefined;
  let through = 0;
  const subscribe = (receive: (event: Event) => void) => {
    listener = receive;
    return () => {
      listener = undefined;
    };
  };
  const snapshot = () => Effect.sync((): Frame => ({ type: 'snapshot', through }));
  const project = (event: Event) => Effect.succeed<Frame>({ type: 'event', event });
  const stream = bounded
    ? snapshotFeed(subscribe, () => Effect.map(snapshot(), (value) => ({ value, covered: () => false })), project, WIRE_PAGE_MAX_ENTRIES)
    : Stream.unwrap(
        Effect.gen(function* () {
          const events = yield* Queue.make<Event>();
          const detach = subscribe((event) => Queue.offerUnsafe(events, event));
          yield* Effect.addFinalizer(() => Effect.sync(detach));
          return Stream.concat(Stream.make(yield* snapshot()), Stream.fromQueue(events).pipe(Stream.mapEffect(project)));
        }),
      );
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const pull = yield* Stream.toPull(stream);
        yield* pull;
        const before = heap();
        const started = performance.now();
        for (let index = 1; index <= count; index += 1) {
          through = index;
          listener?.({ index, text: `event ${index}: ${'x'.repeat(1000)}` });
        }
        const publishMs = performance.now() - started;
        const after = heap();
        const next = yield* pull;
        return {
          arm: bounded ? 'bounded' : 'unbounded-queue',
          count,
          publishMs,
          retainedBytes: after.bytes - before.bytes,
          retainedObjects: after.objects - before.objects,
          resumedWith: next[0]?.type,
        };
      }),
    ),
  );
}

await sample(false, 500);
await sample(true, 500);
for (const count of counts) {
  for (let repeat = 0; repeat < 3; repeat += 1) {
    console.log(JSON.stringify({ repeat, ...(await sample(false, count)) }));
    console.log(JSON.stringify({ repeat, ...(await sample(true, count)) }));
  }
}
