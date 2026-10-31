import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { makeProcessTables, makeProvenSet } from './ProvenSet';
import { Processes, type ProcessIdentity, type ProcessReader } from './ProcessReader';
import { makeResiduals } from './Residuals';

const origin = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'fixture', incarnation: 1, execution: 'ended' });
const pid = 123;
const withProof = Effect.fnUntraced(function* (identity: ProcessIdentity) {
  const reader: ProcessReader = {
    table: Effect.succeed([{ pid, parent: 1, work: pid, birth: '1000000', zombie: false }]),
    members: (work) => Effect.succeed(work === pid ? [{ pid, parent: 1, work: pid, birth: '1000000', zombie: false }] : []),
    scan() {
      return this.table;
    },
    compareBirth: (left, right) => Number(left) - Number(right),
    bornBetween: () => false,
    resolve: () => 'unknown',
    identity: () => identity,
    facts: () => Effect.die('no fields are needed to re-prove the start witness'),
  };
  const tables = yield* makeProcessTables().pipe(Effect.provideService(Processes, reader));
  const proven = yield* makeProvenSet({ tables, leader: pid, birth: '1000000', work: pid });
  yield* proven.grow(yield* tables.read());
  const residuals = yield* makeResiduals.pipe(Effect.provideService(Processes, reader));
  yield* residuals.capture(origin, proven, [{ kind: 'process', pid, relation: 'ancestry', detail: 'survived the ending' }]);
  return residuals;
});

it.effect('a residual pid is refused once a fresh witness identifies its replacement', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const residuals = yield* withProof({ _tag: 'Read', pid, parent: 1, work: pid, birth: '2000000', zombie: false });
      return yield* residuals.end(origin, pid);
    });
    expect(outcome).toMatchObject({ _tag: 'Refused', origin, pid, reason: 'identity-changed', steps: [] });
  }),
);

it.effect('an unreadable witness is refused, while a vanished residual leaves the set', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const unreadable = yield* withProof({ _tag: 'Unreadable' as const, detail: 'denied' });
      const gone = yield* withProof({ _tag: 'Gone' as const });
      return { refused: yield* unreadable.end(origin, pid), ended: yield* gone.end(origin, pid), remaining: yield* gone.all };
    });
    expect(outcome.refused).toMatchObject({ _tag: 'Refused', reason: 'unreadable', steps: [] });
    expect(outcome.ended).toEqual({ _tag: 'Ended', origin, pid, steps: [] });
    expect(outcome.remaining).toEqual([]);
  }),
);

it.effect('a pid named without a retained witness remains unproven rather than gaining signal authority', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const residuals = yield* makeResiduals;
      yield* residuals.capture(origin, undefined, [{ kind: 'process', pid, relation: 'ancestry', detail: 'no retained proof' }]);
      return yield* residuals.end(origin, pid);
    });
    expect(outcome).toMatchObject({ _tag: 'Refused', reason: 'identity-unproven', steps: [] });
  }),
);
