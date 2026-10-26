import { join } from 'node:path';
import { Data, Effect, Fiber, FileSystem, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { shared } from '@runlith/testbed/worlds';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { ExecutionClient, type Client } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { Registration } from '@runlith/executions/protocol/registration';
import type { WireLimits } from '@runlith/executions/protocol/wire';
import { hostTestRoot, registrationOf } from '../../hostFixture';
import { HOLDER_BINARY, HOLDER_LIBRARY, testHolder } from '../../posix/testing/holder';
import { serve } from '../host';
import { HOST_ENTRY } from '../../buildArtifact';
import { bundleWorld } from './artifact';

export type WorldInput = {
  readonly prefix: string;
  readonly directory?: string;
  readonly policy: ExecutionPolicy;
  readonly share: number;
  readonly limits: WireLimits;
  readonly library?: string;
  readonly holder?: (state: string) => ReturnType<typeof testHolder>;
};
export type ServedWorld = {
  readonly directory: string;
  readonly registration: Registration;
  readonly client: Client;
};

export const makeWorld = Effect.fnUntraced(function* ({
  prefix,
  policy,
  share,
  limits,
  directory: supplied,
  library = HOLDER_LIBRARY,
  holder = testHolder,
}: WorldInput) {
  const fs = yield* FileSystem.FileSystem;
  const registrations = yield* HostRegistration;
  const root = hostTestRoot();
  yield* fs.makeDirectory(root, { recursive: true });
  const directory = supplied ?? (yield* fs.makeTempDirectoryScoped({ directory: root, prefix }));
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
  const offered = registrationOf(directory);
  const running = yield* Effect.forkScoped(
    Effect.scoped(serve({ state: directory, registration: offered, library, policy, share, limits })).pipe(
      Effect.provide(holder(directory)),
    ),
  );
  const client = yield* ExecutionClient.make({
    address: { state: directory, installation: offered.installation },
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
    Fiber.join(running).pipe(Effect.andThen(Effect.die(new Error('the host stopped before answering its first status')))),
  );
  return { directory, registration: yield* registrations.read(directory), client } satisfies ServedWorld;
});

export type ProcessWorld = ServedWorld & {
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly boot: string;
  readonly crash: Effect.Effect<void>;
  readonly output: () => string;
};
class WorldSignalFailed extends Data.TaggedError('WorldSignalFailed')<{ readonly message: string }> {}

const FLOCK = 'use Fcntl ":flock"; open(my $f, ">>", $ARGV[0]) or exit 2; exit(flock($f, LOCK_EX | LOCK_NB) ? 0 : 1)';
export const writerClaimAvailable = Effect.fnUntraced(function* (state: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const probe = yield* spawner.spawn(
    ChildProcess.make('/usr/bin/perl', ['-e', FLOCK, `${state}/writer.lock`], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
  );
  const code = yield* probe.exitCode;
  if (code !== 0 && code !== 1) return yield* Effect.die(new Error(`the writer claim probe failed: ${code}`));
  return code === 0;
}, Effect.scoped);

export const makeProcessWorld = Effect.fnUntraced(function* ({
  prefix,
  policy,
  share,
  limits,
  library = HOLDER_LIBRARY,
  directory: supplied,
}: WorldInput) {
  const files = yield* FileSystem.FileSystem;
  const registrations = yield* HostRegistration;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const directory = supplied ?? (yield* files.makeTempDirectoryScoped({ prefix }));
  const registration = registrationOf(directory);
  const boot = `${directory}/boot.json`;
  yield* files.writeFileString(
    boot,
    yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration,
      library,
      policy,
      share,
      limits,
      lifetime: 'with-parent',
    }),
    { mode: 0o600 },
  );
  const bundle = yield* shared(bundleWorld, null);
  const child = yield* spawner.spawn(
    ChildProcess.make(HOLDER_BINARY, [directory, process.execPath, join(bundle.root, HOST_ENTRY), boot], {
      cwd: directory,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  const stop = Effect.flatMap(child.isRunning, (running) =>
    running
      ? Effect.try({
          try: () => {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (cause) {
              if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') return;
              throw cause;
            }
          },
          catch: (cause) => new WorldSignalFailed({ message: `kill host group ${child.pid}: ${String(cause)}` }),
        })
      : Effect.void,
  );
  let output = '';
  const note = (bytes: Uint8Array) =>
    Effect.sync(() => {
      output = (output + new TextDecoder().decode(bytes)).slice(-16384);
    });
  const readers = yield* Effect.forEach([child.stdout, child.stderr], (source) => Effect.forkScoped(Stream.runForEach(source, note)));
  const crash = stop.pipe(Effect.andThen(Effect.forEach(readers, (reader) => Fiber.join(reader))), Effect.asVoid, Effect.orDie);
  yield* Effect.addFinalizer(() => crash);
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
    Effect.flatMap(child.exitCode, (code) => Effect.die(new Error(`the host exited ${code} before serving: ${output}`))),
  );
  return {
    directory,
    registration: yield* registrations.read(directory),
    client,
    child,
    boot,
    crash,
    output: () => output,
  } satisfies ProcessWorld;
});
