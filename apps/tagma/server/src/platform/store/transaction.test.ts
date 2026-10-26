import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Cause, Context, Effect } from 'effect';
import type { StoreIdentity } from '../contract/service/store.js';
import { storeTransaction, UnitOpen, WriterTimings } from './transaction.js';
import { TableMoves } from './moves.js';
import { LateStatementRefused } from './life.js';
import { checkStatement } from './writes.js';

const settled = { transaction: <A, E, R>(body: () => Effect.Effect<A, E, R>) => body() } as unknown as EffectSQLiteBunDatabase;

const machine: StoreIdentity = { path: 'machine.sqlite', generation: 1 };
const graph: StoreIdentity = { path: 'graph.sqlite', generation: 2 };

const unitsOf = (identity: StoreIdentity) => storeTransaction<'machine'>(settled, new WriterTimings(), identity, new TableMoves());

const journal = () => {
  const lines: string[] = [];
  return { lines, note: (line: string) => Effect.sync(() => void lines.push(line)) };
};

class Published extends Context.Service<Published, { readonly lines: string[] }>()('test/Published') {}

describe('commit callbacks of nested units', () => {
  it.effect('wait for the outermost commit of the same store, in the order they were queued', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const { lines, note } = journal();
      const exit = yield* Effect.exit(
        units(
          'outer',
          () =>
            Effect.gen(function* () {
              yield* units('inner', (unit) => unit.afterCommit(note('inner after')), {
                onCommit: () => {
                  lines.push('inner invoked');
                  return note('inner commit');
                },
              });
              yield* note('outer body');
            }),
          { onCommit: () => note('outer commit') },
        ),
      );
      expect(exit._tag).toBe('Success');
      expect(lines).toEqual(['outer body', 'inner after', 'inner invoked', 'inner commit', 'outer commit']);
    }),
  );

  it.effect('never run when the outermost unit rolls back', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const { lines, note } = journal();
      const exit = yield* Effect.exit(
        units(
          'outer',
          () =>
            Effect.andThen(
              units('inner', (unit) => unit.afterCommit(note('inner after')), { onCommit: () => note('inner commit') }),
              Effect.fail('turned back'),
            ),
          { onCommit: () => note('outer commit') },
        ),
      );
      expect(exit._tag).toBe('Failure');
      expect(lines).toEqual([]);
    }),
  );

  it.effect('are dropped with a nested unit that rolls back while the outer one commits', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const { lines, note } = journal();
      const exit = yield* Effect.exit(
        units(
          'outer',
          () =>
            Effect.ignore(
              units('inner', (unit) => Effect.andThen(unit.afterCommit(note('inner after')), Effect.fail('turned back')), {
                onCommit: () => note('inner commit'),
              }),
            ),
          { onCommit: () => note('outer commit') },
        ),
      );
      expect(exit._tag).toBe('Success');
      expect(lines).toEqual(['outer commit']);
    }),
  );

  it.effect('run at their own commit when the nested unit is on another store', () =>
    Effect.gen(function* () {
      const machineUnits = unitsOf(machine);
      const graphUnits = unitsOf(graph);
      const { lines, note } = journal();
      yield* machineUnits('outer', () =>
        Effect.andThen(
          graphUnits('other store', () => Effect.void, { onCommit: () => note('graph commit') }),
          note('outer body'),
        ),
      );
      expect(lines).toEqual(['graph commit', 'outer body']);
    }),
  );

  it.effect('keep the environment of the unit that queued them', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const outer: string[] = [];
      const inner: string[] = [];
      const published = Effect.gen(function* () {
        (yield* Published).lines.push('inner commit');
      });
      yield* units('outer', () =>
        Effect.provideService(
          units('inner', () => Effect.void, { onCommit: () => published }),
          Published,
          { lines: inner },
        ),
      ).pipe(Effect.provideService(Published, { lines: outer }));
      expect(inner).toEqual(['inner commit']);
      expect(outer).toEqual([]);
    }),
  );

  it.effect('all run after one of them dies, and the unit then reports every death', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const { lines, note } = journal();
      const exit = yield* Effect.exit(
        units(
          'outer',
          (unit) =>
            Effect.gen(function* () {
              yield* unit.afterCommit(Effect.die('first tail'));
              yield* unit.afterCommit(note('second tail'));
              yield* units('inner', () => Effect.void, {
                onCommit: () => {
                  throw 'inner tail';
                },
              });
            }),
          {
            onCommit: () => {
              lines.push('outer commit');
              throw 'outer tail';
            },
          },
        ),
      );
      expect(lines).toEqual(['second tail', 'outer commit']);
      expect(
        exit._tag === 'Failure' ? exit.cause.reasons.map((reason) => (reason._tag === 'Die' ? reason.defect : reason._tag)) : [],
      ).toEqual(['first tail', 'inner tail', 'outer tail']);
    }),
  );

  it.effect('keep what a middle caller provided when they climb two units', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const middle: string[] = [];
      const published = Effect.gen(function* () {
        (yield* Published).lines.push('innermost commit');
      });
      yield* units('outer', () =>
        Effect.provideService(
          units('middle', () => units('innermost', () => Effect.void, { onCommit: () => published })),
          Published,
          { lines: middle },
        ),
      );
      expect(middle).toEqual(['innermost commit']);
    }),
  );

  it.effect('run outside every unit they were queued in, so a unit they open commits on its own', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const { lines, note } = journal();
      yield* units('outer', () =>
        units('inner', () => Effect.void, {
          onCommit: () =>
            Effect.orDie(
              Effect.gen(function* () {
                yield* note(`open unit: ${yield* UnitOpen}`);
                yield* units('tail', () => Effect.void, { onCommit: () => note('tail commit') });
              }),
            ),
        }),
      );
      expect(lines).toEqual(['open unit: false', 'tail commit']);
    }),
  );
});

describe('fibers forked inside a unit', () => {
  const forked = Effect.fnUntraced(function* (outcome: Effect.Effect<void, string>) {
    const { lines, note } = journal();
    const exit = yield* Effect.exit(
      unitsOf(machine)(
        'outer',
        () =>
          Effect.andThen(
            Effect.forkChild(Effect.andThen(Effect.never, note('child wrote')).pipe(Effect.onInterrupt(() => note('child interrupted'))), {
              startImmediately: true,
            }),
            outcome,
          ),
        { onCommit: () => note('outer commit') },
      ),
    );
    return { exit, lines };
  });

  it.effect('are interrupted before the unit commits', () =>
    Effect.gen(function* () {
      const { exit, lines } = yield* forked(Effect.void);
      expect(exit._tag).toBe('Success');
      expect(lines).toEqual(['child interrupted', 'outer commit']);
    }),
  );

  it.effect('are interrupted when the unit rolls back', () =>
    Effect.gen(function* () {
      const { exit, lines } = yield* forked(Effect.fail('turned back'));
      expect(exit._tag).toBe('Failure');
      expect(lines).toEqual(['child interrupted']);
    }),
  );

  it.effect('that escaped into an outer scope are refused a statement once the unit has ended', () =>
    Effect.gen(function* () {
      const units = unitsOf(machine);
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const unit = yield* units('outer', (held) => Effect.succeed(held));
          return yield* unit.run(Effect.suspend(() => checkStatement(machine)('insert into "run" ("id") values (?)')));
        }),
      );
      expect(exit._tag === 'Failure' ? Cause.squash(exit.cause) : undefined).toBeInstanceOf(LateStatementRefused);
    }),
  );
});
