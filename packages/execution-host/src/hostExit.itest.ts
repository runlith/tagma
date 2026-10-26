import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Data, Effect, Fiber, FileSystem, Layer, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { WireLimits } from '@runlith/executions/protocol/wire';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { pathOf } from '@runlith/executions/hostArtifacts';
import type { ArtifactRole } from '@runlith/executions/protocol/artifact';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { type Placed, HOST_ENTRY, RUNTIME_PART } from './buildArtifact';
import { Bundle, bundleFixture } from './composition/testing/artifact';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, principalOf } from './hostFixture';
import { writerClaimAvailable } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 1, transports: ['pipes'] });
const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
type Shape = { readonly policy: ExecutionPolicy; readonly limits: WireLimits; readonly share: number };
const PIPES: Shape = { policy, limits, share: hostShare(policy, 1) };
const terminalPolicy = hostPolicy({ executions: 1, transports: ['pty'] });
const TERMINAL: Shape = {
  policy: terminalPolicy,
  limits: hostWireLimits(terminalPolicy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 }),
  share: hostShare(terminalPolicy, 1),
};
class SignalFailed extends Data.TaggedError('SignalFailed')<{ readonly message: string }> {}
const signal = (pid: number, sent: NodeJS.Signals) =>
  Effect.try({
    try: () => {
      try {
        process.kill(pid, sent);
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') return;
        throw cause;
      }
    },
    catch: (cause) => new SignalFailed({ message: `signal ${sent} to ${pid}: ${String(cause)}` }),
  });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));
const fixture = bundleFixture.pipe(Layer.provideMerge(platform));
const requiredPath = (built: Placed, role: ArtifactRole) => {
  const path = pathOf(built.root, built.manifest, role);
  if (path === undefined) throw new Error(`the bundle has no ${role}`);
  return path;
};
type RaiseInput = {
  readonly shape?: Shape;
  readonly preload?: string;
  readonly lifetime?: 'with-parent' | 'detached';
  readonly insecure?: boolean;
};
const raise = Effect.fnUntraced(function* ({ shape = PIPES, preload, lifetime = 'with-parent', insecure = false }: RaiseInput) {
  const built = yield* Bundle;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'host-exit-state-' });
  if (insecure) yield* files.chmod(directory, 0o755);
  const registration = registrationOf(directory);
  const boot = `${directory}/boot.json`;
  yield* files.writeFileString(
    boot,
    yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration,
      library: requiredPath(built, 'platform'),
      policy: shape.policy,
      share: shape.share,
      limits: shape.limits,
      artifact: built.root,
      lifetime,
    }),
    { mode: 0o600 },
  );
  const child = yield* spawner.spawn(
    ChildProcess.make(
      requiredPath(built, 'holder'),
      [
        directory,
        join(built.root, RUNTIME_PART),
        ...(preload === undefined ? [] : ['--preload', preload]),
        join(built.root, HOST_ENTRY),
        boot,
      ],
      { cwd: directory, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    ),
  );
  let output = '';
  const note = (bytes: Uint8Array) =>
    Effect.sync(() => {
      output = (output + new TextDecoder().decode(bytes)).slice(-16384);
    });
  const readers = yield* Effect.forEach([child.stdout, child.stderr], (stream) => Effect.forkScoped(Stream.runForEach(stream, note)));
  yield* Effect.addFinalizer(() =>
    Effect.flatMap(child.isRunning, (running) => (running ? signal(-child.pid, 'SIGKILL') : Effect.void)).pipe(
      Effect.andThen(child.isRunning.pipe(Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('10 millis') }))),
      Effect.andThen(Effect.forEach(readers, (reader) => Fiber.join(reader))),
      Effect.orDie,
      Effect.asVoid,
    ),
  );
  const client = yield* ExecutionClient.make({
    address: { state: directory, installation: registration.installation },
    role: 'custodian',
    limits: shape.limits,
  });
  if (!insecure)
    yield* Effect.raceFirst(
      client.status().pipe(
        Effect.retry({
          while: (failure) => failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable'),
          schedule: Schedule.spaced('25 millis'),
        }),
      ),
      Effect.flatMap(child.exitCode, (code) => Effect.die(new Error(`the host exited ${code} before serving: ${output}`))),
    );
  const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
  return { directory, child, client, key, readers, output: () => output };
});
const shutdown = Effect.fnUntraced(function* (standing: Effect.Success<ReturnType<typeof raise>>) {
  expect((yield* standing.client.take(standing.key('take'), 0))._tag).toBe('Held');
  expect((yield* standing.client.shutdown(standing.key('shutdown')))._tag).toBe('ShutdownComplete');
  yield* standing.child.exitCode;
  expect(
    yield* writerClaimAvailable(standing.directory).pipe(Effect.repeat({ until: (free) => free, schedule: Schedule.spaced('20 millis') })),
  ).toBe(true);
});

layer(fixture, { excludeTestServices: true })('a bundled host that is over', (it) => {
  it.effect(
    'answers shutdown, exits, and frees its writer claim',
    Effect.fnUntraced(function* () {
      yield* shutdown(yield* raise({}));
    }),
  );
  it.effect(
    'exits after shutdown even when an unowned handle holds its event loop',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'host-exit-preload-' });
      const preload = `${directory}/stray.js`;
      yield* files.writeFileString(preload, 'setInterval(() => {}, 1000);\n');
      yield* shutdown(yield* raise({ preload }));
    }),
  );
  it.effect(
    'exits on a signal and frees its writer claim',
    Effect.fnUntraced(function* () {
      const standing = yield* raise({});
      yield* signal(standing.child.pid, 'SIGTERM');
      yield* standing.child.isRunning.pipe(Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('20 millis') }));
      expect(
        yield* writerClaimAvailable(standing.directory).pipe(
          Effect.repeat({ until: (free) => free, schedule: Schedule.spaced('20 millis') }),
        ),
      ).toBe(true);
      yield* Effect.forEach(standing.readers, (reader) => Fiber.join(reader));
    }),
  );
  it.effect(
    'keeps its terminal after holder loss, refuses starts, and frees the claim after the terminal ends',
    Effect.fnUntraced(function* () {
      const standing = yield* raise({ shape: TERMINAL, lifetime: 'detached' });
      const { client, key } = standing;
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const request: LaunchRequest = {
        command: { program: '/bin/cat', args: [], environment: [{ name: 'TERM', value: 'xterm-256color' }] },
        transport: { _tag: 'pty' as const, geometry: { columns: 80, rows: 24 } },
        lifetime: 'held' as const,
        purpose: 'command' as const,
        target: { environment: 'e', namespace: 'n', cwd: standing.directory, dependencies: [] },
        holder: principal,
        origin: principal,
      };
      const started = yield* client.start(key('run'), request);
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`the terminal did not start: ${started._tag}`));
      yield* signal(standing.child.pid, 'SIGKILL');
      yield* standing.child.isRunning.pipe(Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('20 millis') }));
      const status = yield* client
        .status()
        .pipe(Effect.repeat({ until: (status) => status.holder._tag === 'Lost', schedule: Schedule.spaced('20 millis') }));
      expect(status.holder).toMatchObject({ _tag: 'Lost', loss: { reason: 'gone' } });
      const after = yield* client.start(key('after'), request);
      expect(after).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'HolderLost' } });
      expect((yield* client.list({ limit: 1 })).executions[0]?.state.phase).toBe('running');
      expect(yield* writerClaimAvailable(standing.directory)).toBe(false);
      const stopped = yield* client.stop(key('stop'), started.execution, 'explicit-stop', 'destroy');
      expect(stopped.steps.length).toBeGreaterThan(0);
      expect(
        yield* writerClaimAvailable(standing.directory).pipe(Effect.repeat({ until: Boolean, schedule: Schedule.spaced('20 millis') })),
      ).toBe(true);
    }),
  );
  it.effect(
    'exits with its typed boot refusal',
    Effect.fnUntraced(function* () {
      const standing = yield* raise({ insecure: true });
      expect(yield* standing.child.exitCode).not.toBe(0);
      yield* Effect.forEach(standing.readers, (reader) => Fiber.join(reader));
      expect(standing.output()).toContain('CredentialsFailed');
    }),
  );
});
