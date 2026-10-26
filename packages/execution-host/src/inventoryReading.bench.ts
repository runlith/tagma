import { join } from 'node:path';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer, Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionId } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { HostCommands } from './registry/inventory';
import { HostLifecycle } from './registry/shutdown';
import { connectionOf, keyOf, registrationOf, stateDirectories } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const flag = (name: string, fallback: number): number => {
  const given = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return given === undefined ? fallback : Number(given.slice(name.length + 3));
};

const EXECUTIONS = flag('executions', 10_000);
const LIFETIME = process.argv.includes('--calls') ? 'call' : 'command';
const BATCH = 48;
const PAGE = 200;
const ROUNDS = 5;

const agent = Schema.decodeUnknownSync(Principal)('bench');

const shared = {
  command: { program: '/bin/sh', args: ['-c', 'exit 0'], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
} as const;

const ended: LaunchRequest =
  LIFETIME === 'call'
    ? { ...shared, lifetime: 'call', budget: {} }
    : {
        ...shared,
        lifetime: 'command',
        admission: {
          origin: { scope: 'bench', owner: 'bench', cohort: 'bench' },
          limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
          policyIdentity: 'bench',
        },
      };

const median = (values: ReadonlyArray<number>): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

const timed = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
  const started = performance.now();
  const value = yield* effect;
  return { value, ms: performance.now() - started };
});

const directories = stateDirectories('inventory-bench-');
const directory = directories.open();
const capacity = ExecutionCapacity.layer(runtimeProfile({ executions: BATCH, transports: ['pipes'] }));
const state = hostState(
  join(directory, 'executions.sqlite'),
  registrationOf(directory),
  new ProcessPool(undefined, 'stop', undefined, childHosting),
).pipe(Layer.provideMerge(capacity));
const layer = ExecutionRegistry.layer().pipe(
  Layer.provideMerge(Bindings.layer),
  Layer.provideMerge(state),
  Layer.provide(testHolder(directory)),
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner)),
);

const bench = Effect.gen(function* () {
  const custodian = yield* Custodian;
  const connection = connectionOf('connection-bench');
  const taken = yield* custodian.take(keyOf('take-bench'), 0, connection, 'custodian');
  const claim = { connection, epoch: taken.standing.epoch, role: 'custodian' as const };
  const hostExecutions = yield* Executions;
  const hostCommands = yield* HostCommands;
  const lifecycle = yield* HostLifecycle;

  const settle = (ids: ReadonlyArray<ExecutionId>) =>
    Effect.forEach(
      ids,
      (id) =>
        Effect.gen(function* () {
          for (;;) {
            const admitted = yield* Effect.orDie(hostCommands.command(id));
            const phase = admitted?.state.phase ?? (yield* hostExecutions.summary(id))?.state.phase;
            if (phase === undefined || phase === 'ended') return;
            yield* Effect.sleep(2);
          }
        }),
      { concurrency: 'unbounded', discard: true },
    );

  const filling = yield* timed(
    Effect.gen(function* () {
      for (let start = 0; start < EXECUTIONS; start += BATCH) {
        const batch = Array.from({ length: Math.min(EXECUTIONS, start + BATCH) - start }, (_, at) => start + at);
        const outcomes = yield* Effect.forEach(batch, (at) => hostExecutions.start(claim, keyOf(`bench-${at}`), ended), {
          concurrency: 16,
        });
        yield* settle(
          outcomes.flatMap((outcome) => (outcome._tag === 'Started' || outcome._tag === 'Accepted' ? [outcome.execution.execution] : [])),
        );
      }
    }),
  );

  const listed = yield* hostExecutions.list(undefined, EXECUTIONS + 1);
  const ids = listed.executions.map((summary) => summary.state.ref.execution);

  const walkBefore = Effect.gen(function* () {
    let bytes = 0;
    let pages = 0;
    let after: ExecutionId | undefined;
    for (;;) {
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
      const from = after === undefined ? 0 : sorted.findIndex((id) => id === after) + 1;
      const page = sorted.slice(from, from + PAGE);
      const rows = yield* Effect.forEach(page, (id) => hostExecutions.summary(id));
      bytes += JSON.stringify({ executions: rows }).length;
      pages += 1;
      if (from + page.length >= sorted.length) return { pages, bytes };
      after = page[page.length - 1];
    }
  });

  const walkNow = Effect.gen(function* () {
    let bytes = 0;
    let pages = 0;
    let after: ExecutionId | undefined;
    for (;;) {
      const page = yield* hostExecutions.list(after, PAGE);
      bytes += JSON.stringify(page).length;
      pages += 1;
      if (page.after === undefined) return { pages, bytes };
      after = page.after.execution;
    }
  });

  const before: number[] = [];
  const whole: number[] = [];
  const changes: number[] = [];
  let beforePages = 0;
  let wholePages = 0;
  let changedRows = 0;
  let changedBytes = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const since = yield* hostExecutions.inventoryRevision();
    const outcome = yield* hostExecutions.start(claim, keyOf(`bench-transition-${round}`), ended);
    if (outcome._tag === 'Started' || outcome._tag === 'Accepted') yield* settle([outcome.execution.execution]);
    const old = yield* timed(walkBefore);
    before.push(old.ms);
    beforePages = old.value.pages;
    const now = yield* timed(walkNow);
    whole.push(now.ms);
    wholePages = now.value.pages;
    const read = yield* timed(
      Effect.map(hostExecutions.changes(since, PAGE), (answer) => ({ answer, bytes: JSON.stringify(answer).length })),
    );
    changes.push(read.ms);
    changedRows = read.value.answer._tag === 'Changed' ? read.value.answer.executions.length : -1;
    changedBytes = read.value.bytes;
  }

  const status = yield* lifecycle.status();
  return {
    ended: EXECUTIONS + ROUNDS,
    lifetime: LIFETIME,
    held: status.executions,
    kept: status.kept,
    fillSeconds: Math.round(filling.ms / 1000),
    perTransition: {
      before: { walkMs: Math.round(median(before)), pages: beforePages },
      after: { changesMs: Number(median(changes).toFixed(2)), executions: changedRows, bytes: changedBytes },
    },
    wholeReadAfter: { ms: Math.round(median(whole)), pages: wholePages },
  };
});

const report = await Effect.runPromise(Effect.scoped(Effect.flatMap(Layer.build(layer), (context) => Effect.provide(bench, context))));
directories.clear();
console.log(JSON.stringify(report, null, 2));
