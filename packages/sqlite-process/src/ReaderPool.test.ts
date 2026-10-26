import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Tracer from 'effect/Tracer';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import type { ProcessConnection } from './connection.js';
import { TestClock } from 'effect/testing';
import { bulkCeiling, makeReaderPool, READER_IDLE_MS, type ReaderPool } from './ReaderPool.js';

type Fake = ProcessConnection & { readonly at: number };

const at = (taken: ProcessConnection): number => (taken as Fake).at;

class Mirror {
  private opened = 0;
  private readonly lost = new Map<number, () => void>();
  refuses = false;

  readonly open = (onLost: (reason: string) => void): Effect.Effect<ProcessConnection, SqlError> =>
    Effect.suspend(() => {
      if (this.refuses) {
        return Effect.fail(new SqlError({ reason: classifySqliteError(new Error('no'), { operation: 'open' }) }));
      }
      const fresh = { at: this.opened, pid: 40_000 + this.opened++ } as Fake;
      this.lost.set(fresh.at, () => onLost('the child exited'));
      return Effect.succeed(fresh);
    });

  get opens(): number {
    return this.opened;
  }

  kill(which: number): void {
    this.lost.get(which)!();
  }
}

const untilStanding = (pool: ReaderPool, count: number) =>
  Effect.whileLoop({ while: () => pool.state.standing < count, body: () => Effect.yieldNow, step: () => {} });

const untilQueued = (pool: ReaderPool, count: number) =>
  Effect.whileLoop({ while: () => pool.state.queued < count, body: () => Effect.yieldNow, step: () => {} });

const pooled = <A, E = SqlError>(
  ceiling: number,
  work: (pool: ReaderPool, mirror: Mirror) => Effect.Effect<A, E>,
  tracer?: Tracer.Tracer,
) => {
  const mirror = new Mirror();
  const pool = Effect.scoped(Effect.flatMap(makeReaderPool({ ceiling, open: mirror.open }), (taken) => work(taken, mirror)));
  return tracer === undefined ? pool : Effect.provideService(pool, Tracer.Tracer, tracer);
};

const collecting = (): { readonly tracer: Tracer.Tracer; readonly spans: Array<Tracer.NativeSpan> } => {
  const spans: Array<Tracer.NativeSpan> = [];
  return {
    spans,
    tracer: Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    }),
  };
};

const spanNamed = (spans: ReadonlyArray<Tracer.NativeSpan>, name: string): Tracer.NativeSpan | undefined =>
  spans.find((span) => span.name === name);

describe('a declared read takes the first idle reader', () => {
  it.effect('a second read answers off the other reader while the first is still holding one', () =>
    pooled(2, (pool) =>
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const slow = yield* Effect.forkChild(
          Effect.scoped(Effect.flatMap(pool.take, (taken) => Effect.as(Deferred.await(held), at(taken)))),
        );
        yield* untilStanding(pool, 1);

        const second = yield* Effect.scoped(Effect.map(pool.take, at));
        expect(second).toBe(1);
        expect(pool.state.idle).toBe(1);

        yield* Deferred.succeed(held, undefined);
        expect(yield* Fiber.join(slow)).toBe(0);
        expect(pool.state.idle).toBe(2);
      }),
    ),
  );

  it.effect('a read waits only when every reader is busy, and takes the one that frees first', () =>
    pooled(2, (pool, mirror) =>
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>();
        const second = yield* Deferred.make<void>();
        const hold = (until: Deferred.Deferred<void>) =>
          Effect.scoped(Effect.flatMap(pool.take, (taken) => Effect.as(Deferred.await(until), at(taken))));

        const one = yield* Effect.forkChild(hold(first));
        const two = yield* Effect.forkChild(hold(second));
        yield* untilStanding(pool, 2);

        const waiting = yield* Effect.forkChild(Effect.scoped(Effect.map(pool.take, at)));
        yield* Effect.yieldNow;
        expect(pool.state.idle).toBe(0);
        expect(mirror.opens).toBe(2);

        yield* Deferred.succeed(second, undefined);
        expect(yield* Fiber.join(two)).toBe(1);
        expect(yield* Fiber.join(waiting)).toBe(1);

        yield* Deferred.succeed(first, undefined);
        yield* Fiber.join(one);
        expect(pool.state.idle).toBe(2);
        expect(mirror.opens).toBe(2);
      }),
    ),
  );

  it.effect('a read interrupted while waiting leaves the pool exactly as it found it', () =>
    pooled(1, (pool) =>
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const busy = yield* Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(held))));
        yield* untilStanding(pool, 1);

        const queued = yield* Effect.forkChild(Effect.scoped(Effect.map(pool.take, at)));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(queued);

        yield* Deferred.succeed(held, undefined);
        yield* Fiber.join(busy);
        expect(pool.state.idle).toBe(1);
        expect(yield* Effect.scoped(Effect.map(pool.take, at))).toBe(0);
      }),
    ),
  );

  it.effect('a read interrupted after it was handed a reader still gives it back', () =>
    pooled(1, (pool) =>
      Effect.gen(function* () {
        const forever = yield* Deferred.make<void>();
        const taken = yield* Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(forever))));
        yield* untilStanding(pool, 1);

        yield* Fiber.interrupt(taken);
        expect(pool.state.idle).toBe(1);
      }),
    ),
  );
});

describe('readers go out in arrival order', () => {
  it.effect('a read arriving as a reader frees does not overtake the read already waiting for one', () =>
    pooled(1, (pool) =>
      Effect.gen(function* () {
        const served: Array<string> = [];
        const held = yield* Deferred.make<void>();
        const takes = (name: string) => Effect.scoped(Effect.flatMap(pool.take, () => Effect.sync(() => void served.push(name))));

        const holder = yield* Effect.forkChild(
          Effect.flatMap(
            Effect.scoped(
              Effect.flatMap(pool.take, () =>
                Effect.flatMap(
                  Effect.sync(() => void served.push('holder')),
                  () => Deferred.await(held),
                ),
              ),
            ),
            () => takes('newcomer'),
          ),
        );
        yield* untilStanding(pool, 1);

        const first = yield* Effect.forkChild(takes('first waiter'));
        yield* untilQueued(pool, 1);
        const second = yield* Effect.forkChild(takes('second waiter'));
        yield* untilQueued(pool, 2);

        yield* Deferred.succeed(held, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        yield* Fiber.join(holder);
        expect(served).toEqual(['holder', 'first waiter', 'second waiter', 'newcomer']);
      }),
    ),
  );
});

describe('a reader is opened only when the work needs one', () => {
  it.effect('a pool that has answered nothing has opened nothing, and reads one after another keep one reader', () =>
    pooled(4, (pool, mirror) =>
      Effect.gen(function* () {
        expect(mirror.opens).toBe(0);
        expect(pool.state.standing).toBe(0);

        for (let statement = 0; statement < 3; statement++) {
          expect(yield* Effect.scoped(Effect.map(pool.take, at))).toBe(0);
        }
        expect(mirror.opens).toBe(1);
        expect(pool.state.standing).toBe(1);
      }),
    ),
  );

  it.effect('a reader that cannot be opened parks nobody, and the pool counts what it could not give', () =>
    pooled(1, (pool, mirror) =>
      Effect.gen(function* () {
        mirror.refuses = true;
        const refused = yield* Effect.exit(Effect.scoped(pool.take));
        expect(refused._tag).toBe('Failure');
        expect(pool.state.unopened).toBe(1);

        mirror.refuses = false;
        expect(yield* Effect.scoped(Effect.map(pool.take, at))).toBe(0);
        expect(pool.state.standing).toBe(1);
      }),
    ),
  );

  it.effect('a lost reader leaves the set, its neighbour is untouched, and the next demand reopens', () =>
    pooled(2, (pool, mirror) =>
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>();
        const second = yield* Deferred.make<void>();
        const hold = (until: Deferred.Deferred<void>) =>
          Effect.scoped(Effect.flatMap(pool.take, (taken) => Effect.as(Deferred.await(until), at(taken))));

        const one = yield* Effect.forkChild(hold(first));
        const two = yield* Effect.forkChild(hold(second));
        yield* untilStanding(pool, 2);

        mirror.kill(0);
        expect(pool.state.standing).toBe(1);
        expect(pool.state.lost).toBe(1);

        yield* Deferred.succeed(first, undefined);
        expect(yield* Fiber.join(one)).toBe(0);
        expect(pool.state.idle).toBe(0);
        expect(pool.state.standing).toBe(1);

        yield* Deferred.succeed(second, undefined);
        expect(yield* Fiber.join(two)).toBe(1);
        expect(pool.state.idle).toBe(1);

        const third = yield* Deferred.make<void>();
        const fourth = yield* Deferred.make<void>();
        const three = yield* Effect.forkChild(hold(third));
        const four = yield* Effect.forkChild(hold(fourth));
        yield* untilStanding(pool, 2);
        expect(mirror.opens).toBe(3);

        yield* Deferred.succeed(third, undefined);
        yield* Deferred.succeed(fourth, undefined);
        expect(yield* Fiber.join(three)).toBe(1);
        expect(yield* Fiber.join(four)).toBe(2);
        expect(pool.state.standing).toBe(2);
      }),
    ),
  );
});

describe('bulk reads never take the readers a point read needs', () => {
  it.effect('with every reader bulk reads may hold busy, a point read still gets one and a further bulk read waits for a bulk one', () =>
    pooled(4, (pool) =>
      Effect.gen(function* () {
        expect(bulkCeiling(4)).toBe(3);
        const held = yield* Deferred.make<void>();
        const bulks = yield* Effect.forEach(Array.from({ length: 3 }), () =>
          Effect.forkChild(Effect.scoped(Effect.flatMap(pool.takeBulk, (taken) => Effect.as(Deferred.await(held), at(taken))))),
        );
        yield* untilStanding(pool, 3);

        const fourth = yield* Effect.forkChild(Effect.scoped(Effect.map(pool.takeBulk, at)));
        yield* untilQueued(pool, 1);
        expect(pool.state.bulkQueued).toBe(1);

        expect(yield* Effect.scoped(Effect.map(pool.take, at))).toBe(3);

        yield* Deferred.succeed(held, undefined);
        for (const one of bulks) yield* Fiber.join(one);
        yield* Fiber.join(fourth);
        expect(pool.state.queued).toBe(0);
      }),
    ),
  );

  it.effect('a freed reader goes to a waiting point read before a waiting bulk read', () =>
    pooled(2, (pool) =>
      Effect.gen(function* () {
        const served: Array<string> = [];
        const bulkHeld = yield* Deferred.make<void>();
        const pointHeld = yield* Deferred.make<void>();
        const bulkHolder = yield* Effect.forkChild(Effect.scoped(Effect.flatMap(pool.takeBulk, () => Deferred.await(bulkHeld))));
        const pointHolder = yield* Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(pointHeld))));
        yield* untilStanding(pool, 2);

        const bulk = yield* Effect.forkChild(
          Effect.scoped(Effect.flatMap(pool.takeBulk, () => Effect.sync(() => void served.push('bulk')))),
        );
        yield* untilQueued(pool, 1);
        const point = yield* Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Effect.sync(() => void served.push('point')))));
        yield* untilQueued(pool, 2);

        yield* Deferred.succeed(pointHeld, undefined);
        yield* Fiber.join(pointHolder);
        yield* Fiber.join(point);
        expect(served).toEqual(['point']);

        yield* Deferred.succeed(bulkHeld, undefined);
        yield* Fiber.join(bulkHolder);
        yield* Fiber.join(bulk);
        expect(served).toEqual(['point', 'bulk']);
      }),
    ),
  );
});

describe('readers leave when the store stops needing them', () => {
  it.effect('a reader idle past its bound closes, one reader always stands, and the next burst opens again', () =>
    pooled(3, (pool, mirror) =>
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const burst = yield* Effect.forEach(Array.from({ length: 3 }), () =>
          Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(held)))),
        );
        yield* untilStanding(pool, 3);
        yield* Deferred.succeed(held, undefined);
        for (const one of burst) yield* Fiber.join(one);
        expect(pool.state.idle).toBe(3);

        yield* TestClock.adjust(READER_IDLE_MS - 1);
        expect(pool.state.standing).toBe(3);
        yield* TestClock.adjust(1);
        yield* Effect.whileLoop({ while: () => pool.state.standing > 1, body: () => Effect.yieldNow, step: () => {} });
        expect(pool.state.closedIdle).toBe(2);

        yield* TestClock.adjust(READER_IDLE_MS * 10);
        expect(pool.state.standing).toBe(1);

        const again = yield* Deferred.make<void>();
        const second = yield* Effect.forEach(Array.from({ length: 2 }), () =>
          Effect.forkChild(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(again)))),
        );
        yield* untilStanding(pool, 2);
        expect(mirror.opens).toBe(4);
        yield* Deferred.succeed(again, undefined);
        for (const one of second) yield* Fiber.join(one);
      }),
    ),
  );
});

describe('the pool says on the statement what it made that statement wait for', () => {
  it.live('a read that waits carries the queue it joined and the readers busy, and its wait is its own span', () =>
    Effect.gen(function* () {
      const { tracer, spans } = collecting();
      const held = yield* pooled(
        2,
        (pool) =>
          Effect.gen(function* () {
            const first = yield* Deferred.make<void>();
            const hold = () => Effect.withSpan(Effect.scoped(Effect.flatMap(pool.take, () => Deferred.await(first))), 'busy read');
            const one = yield* Effect.forkChild(hold());
            const two = yield* Effect.forkChild(hold());
            yield* untilStanding(pool, 2);

            const third = yield* Effect.forkChild(Effect.withSpan(Effect.scoped(Effect.map(pool.take, at)), 'waiting read'));
            yield* Effect.whileLoop({
              while: () => spanNamed(spans, 'sqlite.reader.wait') === undefined,
              body: () => Effect.yieldNow,
              step: () => {},
            });
            const waited = spanNamed(spans, 'sqlite.reader.wait')!;
            expect(waited.status._tag).toBe('Started');

            yield* Deferred.succeed(first, undefined);
            yield* Fiber.join(third);
            yield* Fiber.join(one);
            yield* Fiber.join(two);
            return waited;
          }),
        tracer,
      );

      const waiting = spanNamed(spans, 'waiting read')!;
      expect(waiting.attributes.get('db.readers.queued')).toBe(1);
      expect(waiting.attributes.get('db.readers.busy')).toBe(2);
      expect(held.status._tag).toBe('Ended');
      expect(held.parent._tag === 'Some' && held.parent.value.spanId).toBe(waiting.spanId);

      const busy = spans.filter((span) => span.name === 'busy read');
      expect(busy).toHaveLength(2);
      expect(busy.every((span) => span.attributes.get('db.readers.queued') === 0)).toBe(true);
      expect(spans.filter((span) => span.name === 'sqlite.reader.wait')).toHaveLength(1);
    }),
  );

  it.effect('the statement that opens a reader names the child it opened', () =>
    Effect.gen(function* () {
      const { tracer, spans } = collecting();
      yield* pooled(2, (pool) => Effect.withSpan(Effect.scoped(Effect.map(pool.take, at)), 'first read'), tracer);
      expect(spanNamed(spans, 'first read')!.attributes.get('db.reader.pid')).toBe(40_000);
    }),
  );
});
