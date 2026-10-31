import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FiberSet } from 'effect';
import { carryCost, CostLedger, costLedgerLayer, CurrentCost, producerCost, rootCost } from './CostLedger.js';

it.effect('a root totals disjoint own and memoized producer work while nested roots preserve its cause', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    yield* rootCost(
      'act',
      Effect.gen(function* () {
        const own = (yield* CurrentCost)!;
        own.counts.statements++;
        own.counts.programStatements += 2;
        yield* rootCost(
          'nested',
          producerCost(
            'publish',
            Effect.gen(function* () {
              const publishing = (yield* CurrentCost)!;
              publishing.counts.statements += 2;
              publishing.counts.units++;
              publishing.counts.programs++;
              publishing.counts.programStatements += 3;
              publishing.counts.statementMs += 8;
              publishing.counts.statementExecMs += 2;
              publishing.counts.writerHoldMs += 3;
              publishing.counts.writerWaitMs += 4;
              publishing.counts.requestBytes += 5;
              publishing.counts.responseBytes += 6;
              publishing.counts.spans += 7;
              yield* producerCost(
                'projection',
                Effect.gen(function* () {
                  (yield* CurrentCost)!.counts.statements += 3;
                }),
              );
              expect(yield* CurrentCost).toBe(publishing);
            }),
          ),
        );
        yield* producerCost(
          'publish',
          Effect.gen(function* () {
            (yield* CurrentCost)!.counts.statements++;
          }),
        );
        expect(yield* CurrentCost).toBe(own);
      }),
      'root',
    ).pipe(Effect.provideService(CostLedger, ledger));

    const page = ledger.read({ limit: 2 });
    expect(page.total).toBe(1);
    expect(page.rows[0]!.own.statements).toBe(1);
    expect(page.rows[0]!.producers.map(({ name, counts }) => [name, counts.statements])).toEqual([
      ['publish', 3],
      ['projection', 3],
    ]);
    expect(page.rows[0]!.total).toEqual({
      statements: 7,
      units: 1,
      programs: 1,
      programStatements: 5,
      statementMs: 8,
      statementExecMs: 2,
      writerHoldMs: 3,
      writerWaitMs: 4,
      requestBytes: 5,
      responseBytes: 6,
      spans: 7,
    });
    expect(page.rows[0]!.endedAt).not.toBeNull();
    expect(yield* CurrentCost).toBeNull();
  }),
);

it.effect('a callback captures cost synchronously through a prebuilt runtime beyond the root trace and its ending', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const run = yield* FiberSet.makeRuntime();
    const charge = Effect.gen(function* () {
      (yield* CurrentCost)!.counts.statements++;
    });
    const callbacks = yield* rootCost(
      'act',
      Effect.sync(() => [carryCost(charge), carryCost(charge, 'late')]).pipe(Effect.withSpan('trace')),
      'root',
    ).pipe(Effect.provideService(CostLedger, ledger));
    const before = ledger.read({ rootId: 'root', limit: 1 });
    expect(before.rows[0]!.total.statements).toBe(0);
    expect(before.rows[0]!.endedAt).not.toBeNull();
    yield* Fiber.join(run(callbacks[0]!));
    yield* Fiber.join(run(callbacks[1]!));
    const after = ledger.read({ rootId: 'root', limit: 1 });
    expect(after.total).toBe(1);
    expect(after.rows[0]!.own.statements).toBe(1);
    expect(after.rows[0]!.producers.map(({ name, counts }) => [name, counts.statements])).toEqual([['late', 1]]);
    expect(after.rows[0]!.total.statements).toBe(2);
    expect(before.rows[0]!.total.statements).toBe(0);
  }),
);

it.effect('a producer without a cause opens a background root and an uncaptured callback can do the same when run', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const work = Effect.gen(function* () {
      (yield* CurrentCost)!.counts.units++;
    });
    const callback = carryCost(work, 'callback');
    yield* producerCost('background', work).pipe(Effect.provideService(CostLedger, ledger));
    yield* callback.pipe(Effect.provideService(CostLedger, ledger));
    expect(ledger.read({ limit: 2 }).rows.map((row) => [row.name, row.total.units, row.endedAt !== null])).toEqual([
      ['background', 1, true],
      ['callback', 1, true],
    ]);
    expect(yield* rootCost('unmounted', producerCost('producer', carryCost(Effect.succeed(42), 'callback')))).toBe(42);
    expect(yield* CurrentCost).toBeNull();
  }),
);

it.effect('an interrupted root ends its ledger lifetime', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const started = yield* Deferred.make<void>();
    const fiber = yield* rootCost('interrupted', Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))).pipe(
      Effect.provideService(CostLedger, ledger),
      Effect.forkScoped,
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);
    expect(ledger.read({ limit: 1 }).rows[0]!.endedAt).not.toBeNull();
    expect(yield* CurrentCost).toBeNull();
  }),
);

it.effect('root failure stays failed and ends its ledger lifetime', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const result = yield* rootCost('failed', Effect.fail('refused')).pipe(Effect.provideService(CostLedger, ledger), Effect.result);
    expect(result).toMatchObject({ _tag: 'Failure', failure: 'refused' });
    expect(ledger.read({ limit: 1 }).rows[0]!.endedAt).not.toBeNull();
    expect(yield* CurrentCost).toBeNull();
  }),
);

it.effect('pages keep an ordered retained suffix, report eviction and do not reinsert late work on an evicted root', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const evicted = ledger.open('old', 'old');
    ledger.open('second', 'second');
    ledger.open('third', 'third');
    const first = ledger.read({ limit: 1 });
    expect(first.rows.map((row) => [row.id, row.sequence])).toEqual([['second', 2]]);
    expect({ total: first.total, next: first.next, evicted: first.evicted }).toEqual({
      total: 2,
      next: { ledgerId: first.ledgerId, sequence: 2 },
      evicted: 1,
    });
    const second = ledger.read({ limit: 1, after: first.next! });
    expect(second.rows.map((row) => row.id)).toEqual(['third']);
    expect({ total: second.total, next: second.next }).toEqual({ total: 2, next: null });
    evicted.counts.statements++;
    expect(ledger.read({ limit: 1, rootId: 'old' })).toEqual({
      ledgerId: first.ledgerId,
      reset: false,
      rows: [],
      total: 0,
      next: null,
      evicted: 1,
      unattributedStatements: null,
    });
    expect(ledger.read({ limit: 1, rootId: 'third' }).rows[0]!.id).toBe('third');
  }),
);

it.effect('a cursor from an earlier ledger explicitly restarts at the new retained suffix', () =>
  Effect.gen(function* () {
    const previous = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    previous.open('old-first', 'old-first');
    previous.open('old-second', 'old-second');
    const before = previous.read({ limit: 1 });
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const empty = ledger.read({ limit: 1, after: before.next! });
    expect(empty.rows).toEqual([]);
    ledger.open('new-first', 'new-first');
    ledger.open('new-second', 'new-second');
    const restarted = ledger.read({ limit: 1, after: before.next! });
    expect(restarted.rows.map((row) => row.id)).toEqual(['new-first']);
    expect(empty.reset).toBe(true);
    expect(empty.ledgerId).not.toBe(before.ledgerId);
    expect(restarted.reset).toBe(true);
    expect(restarted.ledgerId).toBe(empty.ledgerId);
    const continued = ledger.read({ limit: 1, after: restarted.next! });
    expect(continued.rows.map((row) => row.id)).toEqual(['new-second']);
    expect(continued.reset).toBe(false);
    expect(continued.next).toBeNull();
  }),
);
