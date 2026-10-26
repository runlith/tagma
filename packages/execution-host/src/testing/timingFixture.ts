import { join } from 'node:path';
import { Clock, Deferred, Effect, Layer, Schema, type Context, type Scope } from 'effect';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { CallBudget } from '@runlith/executions/protocol/call';
import { ExecutionRef, ExecutionTargetRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { Pace } from '@runlith/executions/protocol/pace';
import { type CallLifetimes, makeCallLifetimes } from '../CallLifetimes';
import { ExecutionCapacity } from '../ExecutionCapacity';
import { type Pacing, makePacing } from '../Pacing';
import { type ProcessWatch, makeProcessWatch } from '../ProcessWatch';
import { ProcessTempo } from '../ProcessTempo';
import { Processes } from '../ProcessReader';
import { type ProgramRules, makeProgramRules } from '../ProgramRules';
import { type ProcessTables, type ProvenSet, makeProcessTables, makeProvenSet } from '../ProvenSet';
import { nativeExecution } from './nativeExecution';
import { OperationReceipt } from '../db/persisted';
import { executionStore, ExecutionStore } from '../store/ExecutionStore';
import { INSTALLATION, fixtureHolder, hostProfile, registrationOf } from '../hostFixture';
import { LEADER, ROOT, World, climbAt, rule } from './processWorld';

export const EXECUTION = 'timing-execution';
export const OPERATION = 'timing-operation';
export const CALL_MS = 900;
export const RULE_MS = 1_100;

export const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: INSTALLATION, execution: EXECUTION, incarnation: 0 });
export const operation = Schema.decodeUnknownSync(HostRequestRef)({ installation: INSTALLATION, operation: OPERATION });
export const budget = Schema.decodeUnknownSync(CallBudget)({ timeoutMs: CALL_MS });

const profile = hostProfile({ executions: 2 });
const target = Schema.decodeUnknownSync(ExecutionTargetRef)({ environment: 'local', namespace: 'default', cwd: '/tmp', dependencies: [] });
const principal = Schema.decodeUnknownSync(Principal)('agent-1');
const receipt = Schema.decodeUnknownSync(OperationReceipt)({ _tag: 'Accepted', execution: ref });

export const storeOver = (directory: string, processes: ProcessPool, generation?: number) =>
  executionStore(join(directory, 'executions.sqlite'), registrationOf(directory), processes).pipe(
    Layer.provideMerge(ExecutionCapacity.layer(profile)),
    Layer.provide(fixtureHolder(generation)),
  );

export const admit = Effect.gen(function* () {
  const capacity = yield* ExecutionCapacity;
  const store = yield* ExecutionStore;
  yield* capacity.reserve(ref.execution, 'pipes');
  yield* store.reserve({
    operation,
    fingerprint: 'timing',
    ref,
    transport: 'pipes',
    lifetime: 'call',
    purpose: 'command',
    target,
    holder: principal,
    origin: principal,
    receipt,
  });
});

export const worldOf = (): World => {
  const world = new World();
  world.files.add(`${ROOT}/node_modules/typescript/bin/tsc`);
  world.spawn(LEADER, 1, ['sh', '-c', 'bun run check'], ROOT, '/bin/sh');
  world.spawn(101, LEADER, ['node', `${ROOT}/node_modules/typescript/bin/tsc`, '-p', '.'], ROOT);
  return world;
};

export type Applied = { readonly pid: number; readonly initial: Pace; readonly pace: Pace };

export const tempoOver = (applied: Applied[]): ProcessTempo['Service'] => ({
  directions: (initial) => [
    { from: 'full', to: 'low' },
    { from: 'low', to: 'full' },
    { from: initial, to: initial },
  ],
  apply: (processes) =>
    Effect.sync(() =>
      processes.map(({ witness, initial, pace }) => {
        applied.push({ pid: witness.pid, initial, pace });
        return { _tag: 'Moved' } as const;
      }),
    ),
});

export type Owners = {
  readonly store: Context.Service.Shape<typeof ExecutionStore>;
  readonly calls: CallLifetimes;
  readonly world: World;
  readonly applied: Applied[];
  readonly killedAtMs: Array<readonly [number, number]>;
  readonly killed: Deferred.Deferred<void>;
};

export const ownersOver = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ExecutionStore>,
  world: World,
  periodMs: number,
  reopening: boolean,
): Effect.fn.Return<Owners, unknown, Scope.Scope> {
  const applied: Applied[] = [];
  const killedAtMs: Array<readonly [number, number]> = [];
  const killed = yield* Deferred.make<void>();
  const calls = yield* makeCallLifetimes.pipe(Effect.provideService(ExecutionStore, store));
  const call = reopening ? yield* store.callOf(operation) : undefined;
  yield* calls.open(operation, ref, call?.budget ?? budget, undefined, call?.timing);
  if (!reopening) yield* calls.arm(operation);

  const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, world.reader));
  const set = yield* makeProvenSet({ tables, leader: LEADER, birth: '600', work: undefined });
  const rules = yield* makeProgramRules({
    set,
    programs: { root: ROOT, rules: [rule('tsc', ['tsc'], RULE_MS)] },
    ports: {
      lookups: { isFile: (path) => world.files.has(path), realPath: (path) => path },
      kill: (witness, signal) =>
        Effect.flatMap(Clock.monotonicTimeNanos, (nanos) => {
          killedAtMs.push([witness.pid, Number(nanos) / 1_000_000]);
          Deferred.doneUnsafe(killed, Effect.void);
          return world.kill(witness, signal);
        }),
      first: 'interrupt',
      changed: Effect.void,
      persist: (bound) => store.recordRules({ execution: ref, bound }).pipe(Effect.orDie),
      climb: climbAt,
    },
    resumed: reopening ? ((yield* store.rulesOf(ref.execution)) ?? []) : [],
  }).pipe(Effect.provideService(Processes, world.reader));
  const watch = yield* makeProcessWatch({ tables, periodMs });
  yield* watch.hold(set);
  yield* watch.enforce(set, rules);

  const pacing = yield* makePacing({ tables }).pipe(
    Effect.provideService(ProcessTempo, tempoOver(applied)),
    Effect.provideService(ExecutionStore, store),
  );
  const native = nativeExecution({ witness: { pid: LEADER, birth: '600' }, proven: set, pace: 'full' });
  const paced = reopening ? yield* store.paceOf(ref.execution) : undefined;
  yield* pacing.hold(ref, native, paced);
  if (!reopening) yield* pacing.change('low');
  return { store, calls, world, applied, killedAtMs, killed };
});
