import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Array, Clock, Effect, FileSystem, Layer, Schema, Tracer } from 'effect';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { CommandAdmission } from '@runlith/executions/protocol/command';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, ExecutionTargetRef, HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from './ExecutionCapacity';
import { executionStore, ExecutionStore } from './store/ExecutionStore';
import { fixtureHolder, hostProfile, registrationOf } from './hostFixture';
import type { OperationReceipt } from './db/persisted';

const flag = (name: string, fallback: number): number => {
  const given = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return given === undefined ? fallback : Number(given.slice(name.length + 3));
};
const positive = Schema.Int.check(Schema.isGreaterThan(0));
const BenchInput = Schema.Struct({ commands: positive, rounds: positive });
const rule = (id: string, words: string) => ({ id, limitMs: 60_000, writer: 'thread:bench-writer', at: '2026-09-26T00:18:04.958Z', words });
const admission = CommandAdmission.make({
  origin: { scope: 'project:5', owner: 'thread:bench-owner', cohort: 'c455cbb4f5723a5b6ac755432c991f5e4d9494820cd13082b65cae73a2c31d80' },
  limits: { executionMs: 20_000, executionCeilingMs: 60_000, origin: 'caller', foregroundMs: 600_000 },
  policyIdentity: 'c455cbb4f5723a5b6ac755432c991f5e4d9494820cd13082b65cae73a2c31d80',
  tool: 'bash',
  requested: 20_000,
  rules: [rule('d88b38f2', 'a hard limit of one minute on every command an agent runs, whatever it is and wherever it runs')],
  programs: {
    root: process.cwd(),
    rules: [
      { ...rule('ffadd7b5', 'a test run past one minute is stopped where it stands'), program: { words: ['bun', 'test'] } },
      { ...rule('6b3beaf7', 'a test run past one minute is stopped where it stands'), program: { words: ['vitest'] } },
      { ...rule('e4da23c2', 'a test run past one minute is stopped where it stands'), program: { words: ['playwright', 'test'] } },
    ],
  },
});
const agent = Principal.make('bench');
const target = ExecutionTargetRef.make({
  environment: 'local',
  namespace: 'default',
  cwd: '/tmp',
  dependencies: ['receipt-a', 'receipt-b'],
});
const spans = new Map<string, number>();
const counting = Tracer.make({
  span: (options) => {
    spans.set(options.name, (spans.get(options.name) ?? 0) + 1);
    return new Tracer.NativeSpan(options);
  },
});

const bench = Effect.gen(function* () {
  const { commands, rounds } = yield* Schema.decodeUnknownEffect(BenchInput)({
    commands: flag('commands', 200),
    rounds: flag('rounds', 20),
  });
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'command-rows-bench-' });
  const registration = registrationOf(directory);
  const layer = executionStore(
    `${directory}/executions.sqlite`,
    registration,
    new ProcessPool(undefined, 'stop', undefined, childHosting),
  ).pipe(Layer.provide(fixtureHolder()), Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ executions: commands }))));
  return yield* Effect.gen(function* () {
    const capacity = yield* ExecutionCapacity;
    const store = yield* ExecutionStore;
    const ids: ExecutionId[] = [];
    for (let at = 0; at < commands; at++) {
      const ref: ExecutionRef = {
        installation: registration.installation,
        execution: ExecutionId.make(`command-${String(at).padStart(5, '0')}`),
        incarnation: 0,
      };
      const receipt: OperationReceipt = { _tag: 'Accepted', execution: ref };
      yield* capacity.reserve(ref.execution, 'pipes');
      yield* store.reserve({
        operation: { installation: registration.installation, operation: HostRequestKey.make(`start-${at}`) },
        fingerprint: `command:${at}`,
        ref,
        transport: 'pipes',
        lifetime: 'command',
        command: admission,
        purpose: 'command',
        target,
        holder: agent,
        origin: agent,
        receipt,
      });
      ids.push(ref.execution);
    }
    yield* store.commandsAt(ids);
    spans.clear();
    const times: number[] = [];
    let rows = 0;
    for (let round = 0; round < rounds; round++) {
      const started = yield* Clock.monotonicTimeNanos;
      rows += (yield* store.commandsAt(ids).pipe(Effect.withTracer(counting))).length;
      times.push(Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000);
    }
    times.sort((left, right) => left - right);
    const median = yield* Effect.fromOption(Array.get(times, Math.floor(times.length / 2)));
    return {
      commands,
      rounds,
      rowsPerRead: rows / rounds,
      medianMs: Number(median.toFixed(2)),
      spansPerRead: Object.fromEntries([...spans].map(([name, count]) => [name, count / rounds])),
    };
  }).pipe(Effect.provide(layer));
});
console.log(JSON.stringify(await Effect.runPromise(Effect.scoped(bench).pipe(Effect.provide(BunFileSystem.layer))), null, 2));
