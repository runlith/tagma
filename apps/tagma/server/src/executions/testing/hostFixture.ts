import { join } from 'node:path';
import { bootPath, type HostBoot } from '@runlith/executions/protocol/boot';
import { Deferred, Effect, Exit, Fiber, FileSystem, Stream } from 'effect';
import { SpawnRefused } from '../../platform/testing/spawn.js';
import { readArtifact, pathOf } from '@runlith/executions/hostArtifacts';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { bootInput, bootText } from '../host/boot.js';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { Registration } from '@runlith/executions/protocol/registration';
import { executionGrant, executionPolicy, executionWireLimits } from '../host/policy.js';

export const BUNDLE_ENGINE = 'bun';
export const BUNDLE_ENTRY = 'host/host.js';
export const BUNDLE_LIBRARY = 'native/libexecution_platform.dylib';
export const BUNDLE_HOLDER = 'native/execution-holder';
const TERM_IGNORED = 'trap "" TERM; exec 3<&0; (trap - TERM; exec "$@") <&3 3<&- & exec 3<&-; wait $!';

export const hostCommand = (bundle: string, state: string): Array<string> => [
  join(bundle, BUNDLE_HOLDER),
  state,
  join(bundle, BUNDLE_ENGINE),
  join(bundle, BUNDLE_ENTRY),
  join(state, 'boot.json'),
];

export const prepareHostFixture = Effect.fn('HostFixture.prepare')(function* (
  state: string,
  installation: string,
  bundle: string,
  policy: ExecutionPolicy = executionPolicy,
) {
  const files = yield* FileSystem.FileSystem;
  const manifest = yield* readArtifact(bundle);
  const own = join(state, 'bundle');
  yield* files.symlink(bundle, own);
  const input = bootInput(state, testHostRegistration(state, installation), manifest, policy, 'with-parent');
  if (input === undefined) return yield* Effect.die('the fixture has no platform role');
  const boot = bootPath(state, manifest.identity.digest);
  yield* files.writeFileString(boot, bootText(input), { mode: 0o600 });
  const holder = pathOf(own, manifest, 'holder');
  const runtime = pathOf(own, manifest, 'runtime');
  const host = pathOf(own, manifest, 'host');
  if (holder === undefined || runtime === undefined || host === undefined) return yield* Effect.die('the fixture has no launch roles');
  return [holder, state, runtime, host, boot];
});

export const startHostFixture = Effect.fn('HostFixture.start')(function* ({
  command,
  state,
}: {
  readonly command: readonly string[];
  readonly state: string;
}) {
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn(['/bin/sh', '-c', TERM_IGNORED, 'sh', ...command], {
          cwd: state,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          detached: true,
        }),
      catch: (cause) => new SpawnRefused({ command, cause }),
    }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null && child.signalCode === null) await child.stdin.end();
        await child.exited;
      }),
  );
  const ready = yield* Deferred.make<void, SpawnRefused>();
  const mark = join(state, 'host.sock');
  let output = '';
  let listening = false;
  const drain = (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    return Stream.runForEach(
      Stream.fromReadableStream({ evaluate: () => stream, onError: (cause) => new SpawnRefused({ command, cause }) }),
      (chunk) =>
        Effect.gen(function* () {
          output = (output + decoder.decode(chunk, { stream: true })).slice(-2000);
          if (listening || !output.includes(mark)) return;
          listening = true;
          yield* Deferred.succeed(ready, undefined);
        }),
    ).pipe(Effect.tapError((failure) => Effect.asVoid(Deferred.fail(ready, failure))));
  };
  const stdout = yield* Effect.forkScoped(drain(child.stdout));
  const stderr = yield* Effect.forkScoped(drain(child.stderr));
  yield* Effect.addFinalizer((exit) =>
    Exit.isFailure(exit) ? Effect.logError('execution host fixture failed', { state, exit: child.exitCode, output }) : Effect.void,
  );
  yield* Effect.raceFirst(
    Deferred.await(ready),
    Effect.gen(function* () {
      const code = yield* Effect.promise(() => child.exited);
      yield* Fiber.join(stdout);
      yield* Fiber.join(stderr);
      return yield* Effect.die(new Error(`The execution host exited ${code} before serving: ${output}`));
    }),
  );
  return child;
});

export const testHostRegistration = (state: string, installation: string): Registration => ({
  version: 1,
  state,
  installation: InstallationId.make(installation),
  protocol: 'executions/1',
  endpoint: { transport: 'unix', path: join(state, 'host.sock') },
  credentials: { custodian: join(state, 'custodian'), recovery: join(state, 'recovery') },
});

export const testHostBoot = (
  state: string,
  installation: string,
  bundle: string,
  policy: typeof executionPolicy = executionPolicy,
): HostBoot => ({
  state,
  registration: testHostRegistration(state, installation),
  library: join(bundle, BUNDLE_LIBRARY),
  policy,
  share: executionGrant.share,
  limits: executionWireLimits,
  artifact: bundle,
  lifetime: 'with-parent',
});
