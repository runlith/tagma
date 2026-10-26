import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Option, Schedule, Stream } from 'effect';
import { ChildProcess } from 'effect/process';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { executionSpawner } from '@runlith/executions/executionSpawner';
import { managedCall } from '@runlith/executions/ManagedCall';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { Adapter } from '../../holder/testing/Adapter';
import { hosted } from './host';
import { posix } from './posix';
import { Host, operation, principal } from './session';

const environment: CommandEnvironment = { materialize: () => Effect.succeed([]) };
const collected = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.runCollect(stream).pipe(Effect.map((chunks) => Buffer.concat(chunks)));
const payload = (bytes: number, salt: number) =>
  Array.from({ length: bytes }, (_, index) => String.fromCharCode(33 + ((index + salt) % 90))).join('');

layer(hosted('POSIX', posix()).layer, { excludeTestServices: true })('POSIX streaming handover', (it) => {
  it.effect('managed streams drain exact stdout and stderr beyond retention before their call completes', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const adapter = yield* Adapter;
      const client = host.client;
      const directory = adapter.directory;
      const spawner = yield* executionSpawner(environment, {
        installation: host.installation,
        purpose: 'internal',
        lifetime: 'call',
        correlation: 'streaming-contract',
        target: { environment: 'contract', namespace: 'contract', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
        readerCredits: host.credits,
      }).pipe(Effect.provide(ExecutionClient.context(client)));
      const spawn = (out: string, err: string) =>
        spawner.spawn(
          ChildProcess.make('/bin/sh', ['-c', 'printf "%s" "$1"; printf "%s" "$2" >&2; exit 3', 'sh', out, err], {
            stdin: 'ignore',
            cwd: directory,
          }),
        );
      const output = (yield* client.capabilities()).execution.output;
      const out = payload(output.retainedBytes + output.landingBytes, 0);
      const err = payload(output.retainedBytes + output.landingBytes, 31);
      const active = yield* spawn(out, err);
      const [stdout, stderr] = yield* Effect.all([collected(active.stdout), collected(active.stderr)], { concurrency: 2 });
      expect(stdout).toEqual(Buffer.from(out));
      expect(stderr).toEqual(Buffer.from(err));
      expect(Number(yield* active.exitCode)).toBe(3);
      const call = managedCall(active);
      if (call === undefined) return yield* Effect.die(new Error('the managed child has no call'));
      expect(yield* call.result).toMatchObject({ _tag: 'Decided', decision: { _tag: 'Completed' } });
    }),
  );

  it.effect('graceful handover preserves output parked behind streaming retention before its first reader', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const adapter = yield* Adapter;
      const limits = (yield* host.client.capabilities()).execution.output;
      const text = 'x'.repeat(limits.retainedBytes + limits.landingBytes);
      const started = yield* host.client.start(yield* operation(host), {
        command: { program: '/bin/sh', args: ['-c', 'printf "%s" "$1"', 'sh', text], environment: [], cwd: adapter.directory },
        transport: { _tag: 'pipes', stdin: 'ignore', streaming: ['stdout'] },
        lifetime: 'held',
        purpose: 'internal',
        target: { environment: 'contract', namespace: 'contract', cwd: adapter.directory, dependencies: [] },
        holder: principal,
        origin: principal,
      });
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`the source was not started: ${started._tag}`));
      const cursor = { ref: started.execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const full = yield* host.client.read(cursor, 1).pipe(
        Effect.repeat({
          while: (read) => offsetValue(read.range.durableThrough) < BigInt(limits.retainedBytes),
          schedule: Schedule.upTo(Schedule.spaced('5 millis'), { duration: '2 seconds' }),
        }),
      );
      expect(full.range.durableThrough).toBe(byteOffset(BigInt(limits.retainedBytes)));
      yield* host.control.yieldLogic;
      const delivered = yield* host.client.subscribe({ _tag: 'Bytes', cursor }, host.credits).pipe(Stream.runCollect);
      expect(delivered.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(Buffer.concat(delivered.flatMap((delivery) => (delivery._tag === 'Bytes' ? [delivery.bytes] : [])))).toEqual(
        Buffer.from(text),
      );
      const ended = yield* Stream.runHead(
        Stream.filter(
          host.client.subscribe({ _tag: 'State', execution: started.execution }, host.credits),
          (delivery) => delivery._tag === 'State' && delivery.summary.state.streams.stdout !== 'open',
        ),
      );
      expect(Option.getOrUndefined(ended)).toMatchObject({ _tag: 'State', summary: { state: { streams: { stdout: 'eof' } } } });
      yield* host.client.retire(yield* operation(host), started.execution);
    }).pipe(Effect.timeout(9_000)),
  );

  it.effect('a source parked without a reader remains explicitly stoppable and its scope can be retired', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const adapter = yield* Adapter;
      const limits = (yield* host.client.capabilities()).execution.output;
      const started = yield* host.client.start(yield* operation(host), {
        command: {
          program: '/bin/sh',
          args: ['-c', 'while :; do printf "%s" "$1"; done', 'sh', 'x'.repeat(limits.retainedBytes)],
          environment: [],
          cwd: adapter.directory,
        },
        transport: { _tag: 'pipes', stdin: 'ignore', streaming: ['stdout'] },
        lifetime: 'held',
        purpose: 'internal',
        target: { environment: 'contract', namespace: 'contract', cwd: adapter.directory, dependencies: [] },
        holder: principal,
        origin: principal,
      });
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`the source was not started: ${started._tag}`));
      const cursor = { ref: started.execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const full = yield* host.client.read(cursor, 1).pipe(
        Effect.repeat({
          while: (read) => offsetValue(read.range.durableThrough) < BigInt(limits.retainedBytes),
          schedule: Schedule.upTo(Schedule.spaced('5 millis'), { duration: '2 seconds' }),
        }),
      );
      expect(full.range.durableThrough).toBe(byteOffset(BigInt(limits.retainedBytes)));
      const stopped = yield* host.client.stop(yield* operation(host), started.execution, 'explicit-stop', 'destroy');
      expect(stopped.confirmed.some((resource) => resource.relation === 'leader' && resource.exit._tag === 'Signal')).toBe(true);
      yield* host.client.retire(yield* operation(host), started.execution);
      expect(yield* host.client.state(started.execution)).toBeUndefined();
    }).pipe(Effect.timeout(9_000)),
  );
});
