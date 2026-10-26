import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Queue, Semaphore } from 'effect';
import { makeCommandQueue, UNIT_BOUND } from './queue.js';

type Entry = {
  readonly projectId: number;
  readonly threadId: string;
  readonly key: string;
  readonly paths: ReadonlySet<string>;
  readonly n: number;
};

const entry = (n: number, projectId = 1, threadId = 'a', paths: readonly string[] = [], key = 'checkout'): Entry => ({
  projectId,
  threadId,
  key,
  paths: new Set(paths),
  n,
});

const turns = (count: number) => Effect.forEach(Array.from({ length: count }), () => Effect.yieldNow, { discard: true });

const gated = Effect.fnUntraced(function* (held: (batch: readonly Entry[]) => boolean) {
  const gate = yield* Semaphore.make(0);
  const calls = yield* Queue.unbounded<readonly Entry[]>();
  const stored: Entry[] = [];
  const batches: number[] = [];
  const queue = makeCommandQueue<Entry>({
    write: Effect.fnUntraced(function* (batch) {
      batches.push(batch.length);
      yield* Queue.offer(calls, batch);
      if (held(batch)) yield* gate.take(1);
      stored.push(...batch);
    }),
  });
  return { queue, gate, calls, stored, batches };
});

it.effect('an append never waits for the drain, and every entry lands in order in units of at most 64', () =>
  Effect.gen(function* () {
    const count = UNIT_BOUND * 2 + 5;
    const { queue, gate, calls, stored, batches } = yield* gated(() => true);
    for (let n = 0; n < count; n += 1) yield* queue.append('checkout', [entry(n)]);
    yield* Queue.take(calls);
    yield* gate.release(count);
    yield* queue.settled({ projectId: 1 });
    expect(stored.map((one) => one.n)).toEqual(Array.from({ length: count }, (_, n) => n));
    expect(Math.max(...batches)).toBeLessThanOrEqual(UNIT_BOUND);
  }),
);

it.effect('a lander waits only for the entries that touch its paths', () =>
  Effect.gen(function* () {
    const { queue, gate, calls, stored } = yield* gated((batch) => batch.some((one) => one.threadId === 'b'));
    yield* queue.append('b', [entry(0, 1, 'b', ['src/held.ts'])]);
    yield* queue.append('a', [entry(1, 1, 'a', ['src/free.ts'])]);
    yield* Queue.take(calls);
    yield* queue.settled({ projectId: 1, paths: ['src/free.ts'] });
    expect(stored.map((one) => one.n)).toEqual([1]);
    const lander = yield* Effect.forkChild(queue.settled({ projectId: 1, paths: ['src/held.ts'] }));
    yield* turns(20);
    expect(lander.pollUnsafe()).toBeUndefined();
    yield* gate.release(1);
    yield* Fiber.join(lander);
    expect(stored.map((one) => one.n).sort()).toEqual([0, 1]);
  }),
);

it.effect('a reader waits for the entries of its selection enqueued before it, and not for another project’s lane', () =>
  Effect.gen(function* () {
    const { queue, gate, calls, stored } = yield* gated((batch) => batch.some((one) => one.projectId === 1));
    yield* queue.append('held', [entry(0, 1, 'a'), entry(1, 1, 'b'), entry(2, 1, 'a')]);
    yield* queue.append('free', [entry(3, 2, 'c')]);
    yield* Queue.take(calls);
    yield* queue.settled({ projectId: 2 });
    yield* queue.settled({ projectId: 1, threadId: 'none' });
    expect(stored.map((one) => one.n)).toContain(3);
    const reader = yield* Effect.forkChild(queue.settled({ projectId: 1 }));
    yield* turns(20);
    expect(reader.pollUnsafe()).toBeUndefined();
    while (reader.pollUnsafe() === undefined) {
      yield* gate.release(1);
      yield* turns(5);
    }
    expect(stored.filter((one) => one.projectId === 1).map((one) => one.n)).toEqual([0, 1, 2]);
  }),
);

it.effect('a checkout barrier includes writers from every home and excludes another checkout', () =>
  Effect.gen(function* () {
    const { queue, gate, calls, stored } = yield* gated((batch) => batch.some((one) => one.key === 'shared'));
    yield* queue.append('a', [entry(0, 1, 'a', ['file'], 'shared')]);
    yield* queue.append('b', [entry(1, 2, 'b', ['file'], 'shared')]);
    yield* queue.append('other', [entry(2, 1, 'c', ['file'], 'other')]);
    yield* Queue.take(calls);
    yield* queue.settled({ checkout: 'other' });
    expect(stored.map((one) => one.n)).toEqual([2]);
    const reader = yield* Effect.forkChild(queue.settled({ checkout: 'shared', paths: ['file'] }));
    yield* turns(5);
    expect(reader.pollUnsafe()).toBeUndefined();
    yield* gate.release(2);
    yield* Fiber.join(reader);
    expect(stored.map((one) => one.n).sort()).toEqual([0, 1, 2]);
  }),
);

it.effect('a failed unit keeps its entries: every later reader fails until a retry writes them', () =>
  Effect.gen(function* () {
    const gate = yield* Semaphore.make(0);
    const stored: Entry[] = [];
    let failing = true;
    const queue = makeCommandQueue<Entry, string>({
      write: (batch) =>
        Effect.andThen(
          gate.take(1),
          Effect.suspend(() => (failing ? Effect.fail('store') : Effect.sync(() => void stored.push(...batch)))),
        ),
    });
    yield* queue.append('checkout', [entry(0)]);
    const reader = yield* Effect.forkChild(Effect.flip(queue.settled({ projectId: 1 })));
    yield* turns(5);
    yield* gate.release(1);
    expect(yield* Fiber.join(reader)).toBe('store');
    yield* gate.release(1);
    expect(yield* Effect.flip(queue.settled({ projectId: 1, threadId: 'a' }))).toBe('store');
    failing = false;
    yield* gate.release(1);
    yield* queue.settled({ projectId: 1 });
    expect(stored.map((one) => one.n)).toEqual([0]);
  }),
);
