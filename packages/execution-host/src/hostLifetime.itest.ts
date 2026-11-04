import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Data, Deferred, Effect, Fiber, FileSystem, Layer, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, principalOf } from './hostFixture';
import { HOLDER_BINARY, HOLDER_LIBRARY } from './posix/testing/holder';
import { Processes, type ProcessIdentity } from './ProcessReader';
import { processLayer } from './composition/platform';

const policy = hostPolicy({ executions: 1, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
const share = hostShare(policy, 1);
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection, processLayer(HOLDER_LIBRARY)).pipe(
  Layer.provideMerge(BunServices.layer),
);
const PARENT = `const [boot, entry, holder, state] = Bun.argv.slice(2);
const child = Bun.spawn([holder,state,process.execPath,entry,boot], {stdin:'pipe',stdout:'ignore',stderr:'inherit'});
console.log(child.pid);
await child.exited;
`;
class SignalFailed extends Data.TaggedError('SignalFailed')<{ readonly message: string }> {}
const signal = (pid: number) =>
  Effect.try({
    try: () => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') return;
        throw cause;
      }
    },
    catch: (cause) => new SignalFailed({ message: `kill ${pid}: ${String(cause)}` }),
  });
const witness = Effect.fnUntraced(function* (pid: number) {
  const processes = yield* Processes;
  const read = processes.identity(pid);
  if (read._tag !== 'Read' || read.birth === undefined)
    return yield* Effect.die(new Error(`no birth witness for process ${pid}: ${JSON.stringify(read)}`));
  return read;
});
type ReadIdentity = Extract<ProcessIdentity, { readonly _tag: 'Read' }>;
const untilGone = Effect.fnUntraced(function* (original: ReadIdentity) {
  const processes = yield* Processes;
  yield* Effect.sync(() => processes.identity(original.pid)).pipe(
    Effect.repeat({
      schedule: Schedule.spaced('25 millis'),
      until: (read) => read._tag === 'Gone' || (read._tag === 'Read' && read.birth !== original.birth),
    }),
  );
});
const raise = Effect.fnUntraced(function* (lifetime: 'with-parent' | undefined) {
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'host-lifetime-' });
  const registration = registrationOf(directory);
  const boot = `${directory}/boot.json`;
  yield* files.writeFileString(
    boot,
    yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration,
      library: HOLDER_LIBRARY,
      policy,
      share,
      limits,
      lifetime,
    }),
    { mode: 0o600 },
  );
  const entry = `${directory}/parent.mjs`;
  yield* files.writeFileString(entry, PARENT);
  const parent = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [entry, boot, `${import.meta.dir}/main.ts`, HOLDER_BINARY, directory], {
      cwd: directory,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'inherit',
    }),
  );
  const named = yield* Deferred.make<number>();
  const reader = yield* Effect.forkScoped(
    Stream.runForEach(Stream.splitLines(Stream.decodeText(parent.stdout)), (line) =>
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.NumberFromString)(line), (pid) => Deferred.succeed(named, pid)),
    ),
  );
  const hostPid = yield* Effect.raceFirst(
    Deferred.await(named),
    Fiber.join(reader).pipe(Effect.andThen(Effect.die(new Error('the parent did not publish its host pid')))),
  );
  const held = yield* witness(hostPid);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const processes = yield* Processes;
      const read = processes.identity(hostPid);
      if (read._tag === 'Read' && read.birth === held.birth) yield* signal(-hostPid).pipe(Effect.orDie);
    }),
  );
  const client = yield* ExecutionClient.make({
    address: { state: directory, installation: registration.installation },
    role: 'custodian',
    limits,
  });
  yield* Effect.raceFirst(
    client.status().pipe(
      Effect.retry({
        while: (failure) => failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable'),
        schedule: Schedule.spaced('25 millis'),
      }),
    ),
    parent.isRunning.pipe(
      Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('25 millis') }),
      Effect.andThen(Effect.die(new Error('the parent exited before its host served'))),
    ),
  );
  const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
  return { parent, held, client, key, directory };
});

layer(platform, { excludeTestServices: true })('a host lifetime', (it) => {
  it.effect(
    'with-parent ends its held child and its holder when its parent dies',
    Effect.fnUntraced(function* () {
      const { parent, held, client, key, directory } = yield* raise('with-parent');
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const started = yield* client.start(key('child'), {
        command: { program: '/bin/sleep', args: ['30'], environment: [], cwd: directory },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'held',
        purpose: 'internal',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
      });
      if (started._tag !== 'Started' || started.native.pid === undefined)
        return yield* Effect.die(new Error(`the child did not start: ${started._tag}`));
      const child = yield* witness(started.native.pid);
      yield* signal(parent.pid);
      yield* untilGone(held);
      yield* untilGone(child);
      expect((yield* Processes).identity(child.pid)._tag).toBe('Gone');
    }),
  );
  it.effect(
    'an absent lifetime leaves a serving host after its parent dies until explicitly shut down',
    Effect.fnUntraced(function* () {
      const { parent, held, client, key } = yield* raise(undefined);
      yield* signal(parent.pid);
      yield* parent.isRunning.pipe(Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('25 millis') }));
      expect((yield* client.status()).installation).toBe(key('status').installation);
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      expect((yield* client.shutdown(key('shutdown')))._tag).toBe('ShutdownComplete');
      yield* untilGone(held);
    }),
  );
});
