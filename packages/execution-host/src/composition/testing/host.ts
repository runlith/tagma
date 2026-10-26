import { endpointConnection } from '@runlith/executions/posix/endpoint';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Data, Deferred, Effect, Exit, Fiber, FileSystem, Layer, PubSub, Schema, Scope, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join } from 'node:path';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostBoot } from '@runlith/executions/protocol/boot';
import type { UsagePolicy } from '@runlith/executions/protocol/capacity';
import { Adapter } from '../../holder/testing/Adapter';
import { operation, Host, type HostAdapter } from './session';
import { heldHost, HOLDER_LIBRARY } from '../../posix/testing/holder';
import { hostPolicy, hostShare, hostWireLimits, registrationOf } from '../../hostFixture';
import { HOST_ENTRY } from '../../buildArtifact';
import { Bundle, bundleFixture } from './artifact';

type Options = {
  readonly executions?: number;
  readonly nofile?: number;
  readonly usage?: UsagePolicy;
  readonly lifetime?: 'with-parent' | 'detached';
};
class HostFailed extends Data.TaggedError('HostFailed')<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}
const failed = (detail: string) => new HostFailed({ detail });

const makeHost = Effect.fn('host.contracts.open')(function* (options: Options) {
  const platform = yield* Adapter;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const directory = platform.directory;
  const bundle = yield* Bundle;
  const entry = join(bundle.root, HOST_ENTRY);
  const registration = registrationOf(directory);
  const executions = options.executions ?? 2;
  const policy = hostPolicy({ executions, custodyReceipts: 128, usage: options.usage });
  const funded = {
    ...policy,
    host: { ...policy.host, bindings: 32, custodyReceipts: 128, tombstones: 32 },
    execution: {
      ...policy.execution,
      geometry: { rows: 48, columns: 140, scrollbackRows: 100 },
      receipts: 64,
    },
  };
  const limits = hostWireLimits(funded, executions, { envelopeBytes: 1024 * 1024, connections: 2, requests: 4 });
  const boot = join(directory, 'contract-boot.json');
  yield* files.writeFileString(
    boot,
    yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration,
      library: HOLDER_LIBRARY,
      policy: funded,
      share: hostShare(funded, executions),
      limits,
      lifetime: options.lifetime ?? 'with-parent',
    }),
    { mode: 0o600 },
  );
  const command = heldHost(entry, boot);
  const argv =
    options.nofile === undefined
      ? command
      : ['/bin/sh', '-c', `ulimit -S -n ${options.nofile}; ulimit -H -n ${options.nofile}; exec "$@"`, 'sh', ...command];
  const child = yield* Effect.acquireRelease(
    Effect.try({ try: () => Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }), catch: (error) => failed(String(error)) }),
    (spawned) =>
      Effect.gen(function* () {
        if (spawned.exitCode === null) spawned.kill('SIGKILL');
        yield* Effect.promise(() => spawned.exited);
      }),
  );
  const serving = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
  const unreadable = yield* Deferred.make<never, HostFailed>();
  const initial = yield* PubSub.subscribe(serving);
  let output = '';
  const read = (source: ReadableStream<Uint8Array>) =>
    Stream.fromReadableStream({
      evaluate: () => source,
      onError: (error) => failed(String(error)),
    }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        output += `${line}\n`;
        return line.includes(registration.endpoint.path) ? PubSub.publish(serving, undefined) : Effect.void;
      }),
      Effect.tapError((error) => Deferred.fail(unreadable, error)),
    );
  const stdout = yield* Effect.forkScoped(read(child.stdout));
  const stderr = yield* Effect.forkScoped(read(child.stderr));
  const wait = Effect.fn('host.contracts.serving')(
    function* (subscription: PubSub.Subscription<void>) {
      yield* PubSub.take(subscription);
    },
    Effect.raceFirst(
      Effect.flatMap(
        Effect.promise(() => child.exited),
        () => failed(`the host exited before serving: ${output}`),
      ),
    ),
    Effect.raceFirst(Deferred.await(unreadable)),
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () => failed(`the host did not serve: ${output}`),
    }),
  );
  yield* wait(initial);
  const scope = yield* Scope.fork(yield* Effect.scope);
  const client = yield* Scope.provide(
    ExecutionClient.make({
      address: { state: directory, installation: registration.installation },
      role: 'custodian',
      limits,
      budget: { handshakeMs: 5_000 },
    }),
    scope,
  );
  const holding = () => child.exitCode === null && child.signalCode === null;
  let orphanLogic: number | undefined;
  const logicPid = Effect.fn('host.contracts.logicPid')(function* () {
    const probe = yield* spawner.spawn(
      ChildProcess.make('pgrep', ['-P', String(child.pid), '-f', entry], { stdout: 'pipe', stderr: 'pipe' }),
    );
    const text = Buffer.concat(yield* Stream.runCollect(probe.stdout)).toString();
    const code = yield* probe.exitCode;
    const pids = text
      .trim()
      .split('\n')
      .map(Number)
      .filter((pid) => pid > 0);
    if (code !== 0 || pids.length !== 1) return yield* failed(`the fixture could not identify its logic: ${code} ${text}`);
    return pids[0]!;
  }, Effect.scoped);
  const host = Host.of({
    client,
    control: {
      restartLogic: Effect.scoped(
        Effect.gen(function* () {
          const pid = yield* logicPid();
          const listening = yield* PubSub.subscribe(serving);
          yield* Effect.try({ try: () => process.kill(pid, 'SIGKILL'), catch: (error) => failed(String(error)) });
          yield* wait(listening);
          const standing = yield* client.status();
          const taken = yield* client.take(yield* operation(host), standing.custody.revision);
          if (taken._tag !== 'Held') return yield* failed(`the restarted host could not be taken: ${taken._tag}`);
        }),
      ).pipe(Effect.withSpan('host.contracts.restartLogic')),
      yieldLogic: Effect.scoped(
        Effect.gen(function* () {
          const listening = yield* PubSub.subscribe(serving);
          const quiesced = yield* client.quiesce(yield* operation(host));
          if (quiesced._tag === 'Refused') return yield* failed(`the host refused to quiesce: ${quiesced.refusal._tag}`);
          const yielding = yield* client.yield(quiesced.ticket);
          if (yielding._tag !== 'Yielding') return yield* failed(`the host did not yield: ${yielding._tag}`);
          yield* wait(listening);
          const standing = yield* client.status();
          const taken = yield* client.take(yield* operation(host), standing.custody.revision);
          if (taken._tag !== 'Held') return yield* failed(`the next logic could not be taken: ${taken._tag}`);
        }),
      ).pipe(Effect.withSpan('host.contracts.yieldLogic')),
      loseHolder: Effect.gen(function* () {
        orphanLogic = yield* logicPid();
        child.kill('SIGKILL');
        yield* Effect.promise(() => child.exited);
      }).pipe(Effect.withSpan('host.contracts.loseHolder')),
    },
    installation: registration.installation,
    credits: limits.credits,
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (holding()) yield* client.shutdown(yield* operation(host)).pipe(Effect.timeout(5_000));
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Scope.close(scope, Exit.void);
          if (holding()) child.kill('SIGKILL');
          if (orphanLogic !== undefined && (yield* platform.standing(orphanLogic)) === 'running')
            yield* Effect.try({ try: () => process.kill(orphanLogic!, 'SIGKILL'), catch: (error) => failed(String(error)) });
          yield* Effect.promise(() => child.exited);
          yield* Fiber.join(stdout);
          yield* Fiber.join(stderr);
        }).pipe(Effect.orDie),
      ),
      Effect.orDie,
    ),
  );
  const took = yield* client.take(yield* operation(host), 0);
  if (took._tag !== 'Held') return yield* failed(`the contract host could not be taken: ${took._tag}`);
  return host;
});

export const hosted = (name: string, platform: Layer.Layer<Adapter, unknown>, options: Options = {}): HostAdapter => ({
  name,
  steps: { hangup: 'hang-up', interrupt: 'interrupt', terminate: 'terminate', kill: 'kill' },
  layer: Layer.effect(Host, makeHost(options)).pipe(
    Layer.provideMerge(platform),
    Layer.provide(bundleFixture),
    Layer.provide(HostRegistration.layer),
    Layer.provide(endpointConnection),
    Layer.provide(BunServices.layer),
  ),
});
