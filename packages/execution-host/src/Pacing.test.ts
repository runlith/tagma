import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { Pace } from '@runlith/executions/protocol/pace';
import { makePacing } from './Pacing';
import { nativeExecution } from './testing/nativeExecution';
import { unreadStore } from './testing/store';
import { ProcessTempo } from './ProcessTempo';
import { Processes } from './ProcessReader';
import { makeProcessTables, makeProvenSet } from './ProvenSet';
import type { PaceRecord } from './db/persisted';
import { ExecutionStore } from './store/ExecutionStore';
import { StoredExecutionMissing } from './store/errors';
import { LEADER, ROOT, World } from './testing/processWorld';

const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });

it.effect('a refused pace acquisition leaves no execution eligible for later pace changes', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh'], ROOT, '/bin/sh');
    const { tables, native } = yield* nativeOf(world, 'full');
    const given = fixture();
    const store = ExecutionStore.of({
      ...given.store,
      recordPace: () => Effect.fail(new StoredExecutionMissing({ execution: ref.execution })),
    });
    const pacing = yield* makePacing({ tables }).pipe(
      Effect.provideService(ProcessTempo, given.tempo),
      Effect.provideService(ExecutionStore, store),
    );
    expect(yield* Effect.flip(pacing.hold(ref, native))).toMatchObject({ _tag: 'PaceNotRecorded' });
    expect(pacing.paceOf(ref.execution)).toBeUndefined();
    expect(yield* pacing.change('low')).toEqual({ report: { _tag: 'Applied', pace: 'low', reached: 0, kept: 0, failed: 0 }, moved: [] });
  }),
);

it.effect('a move running work cannot make takes it as near as its directions allow and counts it as kept', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh'], ROOT, '/bin/sh');
    const ran = fixture();
    const tempo: ProcessTempo['Service'] = {
      ...ran.tempo,
      directions: () => [
        { from: 'low', to: 'lowest' },
        { from: 'lowest', to: 'low' },
      ],
    };
    const { tables, native } = yield* nativeOf(world, 'low');
    const pacing = yield* makePacing({ tables }).pipe(
      Effect.provideService(ProcessTempo, tempo),
      Effect.provideService(ExecutionStore, ran.store),
    );
    yield* pacing.hold(ref, native);
    yield* pacing.change('lowest');
    expect(yield* pacing.change('full')).toEqual({
      report: { _tag: 'Applied', pace: 'full', reached: 0, kept: 1, failed: 0 },
      moved: [ref.execution],
    });
    expect(ran.paces.get(LEADER)).toBe('low');
    expect(pacing.spawning).toBe('full');
  }),
);

const fixture = () => {
  const paces = new Map<number, Pace>();
  const written: PaceRecord[] = [];
  const tempo: ProcessTempo['Service'] = {
    directions: (initial) => [
      { from: 'full', to: 'low' },
      { from: 'low', to: 'full' },
      { from: 'full', to: 'lowest' },
      { from: 'lowest', to: 'low' },
      { from: initial, to: initial },
    ],
    apply: (processes) =>
      Effect.sync(() =>
        processes.map(({ witness, pace }) => {
          paces.set(witness.pid, pace);
          return { _tag: 'Moved' } as const;
        }),
      ),
  };
  const store = ExecutionStore.of({
    ...unreadStore,
    recordPace: (record) => Effect.sync(() => void written.push(record)),
  });
  return { paces, written, tempo, store };
};

const nativeOf = Effect.fnUntraced(function* (world: World, pace: Pace) {
  const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, world.reader));
  const proven = yield* makeProvenSet({ tables, leader: LEADER, birth: '600', work: undefined });
  return { tables, native: nativeExecution({ witness: { pid: LEADER, birth: '600' }, proven, pace }) };
});

it.effect(
  'a round keeps lowest on every live process, otherwise moves only newly found processes of work that stood at lowest, and leaves a process lowered by someone else to them',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'sleep 1'], ROOT, '/bin/sh');
      const ran = fixture();
      const tempo: ProcessTempo['Service'] = {
        ...ran.tempo,
        directions: () => [
          { from: 'full', to: 'lowest' },
          { from: 'lowest', to: 'full' },
        ],
      };
      const { tables, native } = yield* nativeOf(world, 'full');
      const pacing = yield* makePacing({ tables }).pipe(
        Effect.provideService(ProcessTempo, tempo),
        Effect.provideService(ExecutionStore, ran.store),
      );
      yield* pacing.hold(ref, native);
      yield* pacing.follow;
      world.spawn(LEADER + 1, LEADER, ['sleep', '1']);
      ran.paces.set(LEADER + 1, 'lowest');
      yield* native.proven!.grow(yield* tables.read());
      yield* pacing.follow;
      expect(ran.paces).toEqual(
        new Map([
          [LEADER, 'full'],
          [LEADER + 1, 'lowest'],
        ]),
      );
      yield* pacing.change('lowest');
      ran.paces.set(LEADER, 'full');
      yield* pacing.follow;
      expect(ran.paces).toEqual(
        new Map([
          [LEADER, 'lowest'],
          [LEADER + 1, 'lowest'],
        ]),
      );
      yield* pacing.change('full');
      world.spawn(LEADER + 2, LEADER, ['sleep', '1']);
      ran.paces.set(LEADER + 2, 'lowest');
      ran.paces.set(LEADER, 'lowest');
      yield* TestClock.adjust('1 millis');
      yield* native.proven!.grow(yield* tables.read());
      yield* pacing.follow;
      yield* pacing.follow;
      expect(ran.paces).toEqual(
        new Map([
          [LEADER, 'lowest'],
          [LEADER + 1, 'full'],
          [LEADER + 2, 'full'],
        ]),
      );
    }),
);

it.effect(
  'a reopened execution is held at its written pace, whatever the new process would have chosen, and still lifts processes it finds after having stood at lowest',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'sleep 1'], ROOT, '/bin/sh');
      const first = fixture();
      const second = fixture();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const { tables, native } = yield* nativeOf(world, 'full');
          const pacing = yield* makePacing({ tables }).pipe(
            Effect.provideService(ProcessTempo, first.tempo),
            Effect.provideService(ExecutionStore, first.store),
          );
          yield* pacing.hold(ref, native);
          yield* pacing.change('lowest');
          yield* pacing.change('low');
        }),
      );
      const last = first.written.at(-1);
      expect(last).toEqual({ execution: ref, initial: 'full', target: 'low', lowered: true });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const { tables, native } = yield* nativeOf(world, 'full');
          const pacing = yield* makePacing({ tables }).pipe(
            Effect.provideService(ProcessTempo, second.tempo),
            Effect.provideService(ExecutionStore, second.store),
          );
          yield* pacing.hold(ref, native, { initial: last!.initial, target: last!.target, lowered: last!.lowered });
          world.spawn(LEADER + 1, LEADER, ['sleep', '1']);
          second.paces.set(LEADER + 1, 'lowest');
          yield* native.proven!.grow(yield* tables.read());
          yield* pacing.follow;
        }),
      );
      expect(second.paces).toEqual(
        new Map([
          [LEADER, 'low'],
          [LEADER + 1, 'low'],
        ]),
      );
      expect(second.written.at(-1)).toEqual({ execution: ref, initial: 'full', target: 'low', lowered: true });
    }),
);
