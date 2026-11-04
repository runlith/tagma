import { expect } from 'bun:test';
import { kind, world } from '@runlith/testbed/worlds';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Data, Effect, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRequestKey, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { WireLimits } from '@runlith/executions/protocol/wire';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from '../../hostFixture';
import { makeProcessWorld, type ProcessWorld } from './servedWorld';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';
import { processLayer } from '../platform';
import { processControl } from '../../posix/control';
import { Processes } from '../../ProcessReader';
import { ProcessControl } from '../../ProcessControl';

export const policy = hostPolicy({ executions: 12, transports: ['pipes'], custodyReceipts: 32 });
export const limits = hostWireLimits(policy, 12, { envelopeBytes: 16384, connections: 4, requests: 8 });
const native = Layer.effect(ProcessControl, Effect.map(Processes, processControl)).pipe(Layer.provideMerge(processLayer(HOLDER_LIBRARY)));
export const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection, native).pipe(Layer.provideMerge(BunServices.layer));
export class World extends Context.Service<World, ProcessWorld>()('test/HostProcess/World') {}
type FixtureInput = { readonly policy: ExecutionPolicy; readonly executions: number; readonly limits: WireLimits };
export const processWorld = kind(World, ({ policy, executions, limits }: FixtureInput, directory) =>
  Effect.gen(function* () {
    yield* (yield* FileSystem.FileSystem).makeDirectory(directory, { recursive: true, mode: 0o700 });
    return yield* makeProcessWorld({ prefix: 'host-process-', directory, policy, limits, share: hostShare(policy, executions) });
  }).pipe(Effect.provide(platform)),
);
export const fixture = (params: FixtureInput) => Layer.merge(world(processWorld, params), platform);
export const key = (host: ProcessWorld, name: string): HostRequestRef => ({
  installation: host.registration.installation,
  operation: HostRequestKey.make(name),
});
export const take = Effect.fnUntraced(function* (name: string) {
  const host = yield* World;
  const first = yield* host.client.take(key(host, name), 0);
  const held = first._tag === 'Stale' ? yield* host.client.take(key(host, `${name}-standing`), first.standing.revision) : first;
  expect(held._tag).toBe('Held');
  return host;
});
export const request = (host: ProcessWorld, program: string, args: readonly string[]): LaunchRequest => ({
  command: { program, args, cwd: host.directory, environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: host.directory, dependencies: [] },
  holder: principalOf('tester'),
  origin: principalOf('tester'),
});
type StartInput = { readonly host: ProcessWorld; readonly name: string; readonly request: LaunchRequest };
export const start = Effect.fnUntraced(function* ({ host, name, request }: StartInput) {
  const answer = yield* host.client.start(key(host, name), request);
  if (answer._tag !== 'Started') return yield* Effect.die(new Error(`start ${name}: ${answer._tag}`));
  return answer;
});
export const lane = Effect.gen(function* () {
  const host = yield* World;
  const principal = principalOf('tester');
  const answer = yield* host.client.openBinding(principal);
  if (answer._tag !== 'Bound') return yield* Effect.die(new Error(`binding: ${answer._tag}`));
  return { binding: answer.binding, principal };
});
export const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.runCollect(stream).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString()));
export const through = <E>(stream: Stream.Stream<ExecutionFeedItem, E>, marker: string) =>
  Stream.runLast(
    Stream.takeUntil(
      Stream.scan(
        stream,
        () => '',
        (held, delivery) => (delivery._tag === 'Bytes' ? held + new TextDecoder().decode(delivery.bytes) : held),
      ),
      (held) => held.includes(marker),
    ),
  );
export const bytes = (host: ProcessWorld, ref: ExecutionRef, stream: 'stdout' | 'pty' = 'stdout', offset = 0n) =>
  host.client.subscribe({ _tag: 'Bytes', cursor: { ref, stream, offset: byteOffset(offset) } }, limits.credits);
class FixtureFailed extends Data.TaggedError('FixtureFailed')<{ readonly message: string }> {}
export const failed = (cause: unknown) => new FixtureFailed({ message: String(cause) });
export const command = Effect.fnUntraced(function* (argv: readonly [string, ...string[]]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(argv[0], argv.slice(1), { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const [stdout, stderr, code] = yield* Effect.all([text(child.stdout), text(child.stderr), child.exitCode], { concurrency: 3 });
  return { stdout, stderr, code: Number(code) };
}, Effect.scoped);
