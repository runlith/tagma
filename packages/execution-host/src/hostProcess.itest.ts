import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, shared, world } from '@runlith/testbed/worlds';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Data, Deferred, Effect, Fiber, FileSystem, Layer, Option, Schedule, Schema, Scope, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { spawn as spawnDetached } from 'node:child_process';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { executionSpawner, type SpawnContext } from '@runlith/executions/executionSpawner';
import { managedCall } from '@runlith/executions/ManagedCall';
import { recoveryClient } from '@runlith/executions/RecoveryClient';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { CallCancellation, type CallStopping } from '@runlith/executions/protocol/call';
import type { CommandLimits } from '@runlith/executions/protocol/command';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import { byteOffset } from '@runlith/executions/protocol/record';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { HostFrame, SubscriptionId, WIRE_VERSION, frameSize, type WireLimits } from '@runlith/executions/protocol/wire';
import { hostPolicy, hostShare, hostWireLimits, principalOf, registrationOf } from './hostFixture';
import { makeProcessWorld, writerClaimAvailable, type ProcessWorld } from './composition/testing/servedWorld';
import { bundleWorld } from './composition/testing/artifact';
import { HOST_ENTRY } from './buildArtifact';
import { HOLDER_LIBRARY } from './posix/testing/holder';
import { processLayer } from './composition/macos';
import { processControl } from './posix/control';
import { background } from './posix/testing/tempo';
import { Processes } from './ProcessReader';
import { ProcessControl } from './ProcessControl';

const policy = hostPolicy({ executions: 12, transports: ['pipes'], custodyReceipts: 32 });
const limits = hostWireLimits(policy, 12, { envelopeBytes: 16384, connections: 4, requests: 8 });
const native = Layer.effect(ProcessControl, Effect.map(Processes, processControl)).pipe(Layer.provideMerge(processLayer(HOLDER_LIBRARY)));
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection, native).pipe(Layer.provideMerge(BunServices.layer));
class World extends Context.Service<World, ProcessWorld>()('test/HostProcess/World') {}
type FixtureInput = { readonly policy: ExecutionPolicy; readonly executions: number; readonly limits: WireLimits };
const processWorld = kind(World, ({ policy, executions, limits }: FixtureInput, directory) =>
  Effect.gen(function* () {
    yield* (yield* FileSystem.FileSystem).makeDirectory(directory, { recursive: true, mode: 0o700 });
    return yield* makeProcessWorld({ prefix: 'host-process-', directory, policy, limits, share: hostShare(policy, executions) });
  }).pipe(Effect.provide(platform)),
);
const fixture = (params: FixtureInput) => Layer.merge(world(processWorld, params), platform);
const key = (host: ProcessWorld, name: string): HostRequestRef => ({
  installation: host.registration.installation,
  operation: HostRequestKey.make(name),
});
const take = Effect.fnUntraced(function* (name: string) {
  const host = yield* World;
  const first = yield* host.client.take(key(host, name), 0);
  const held = first._tag === 'Stale' ? yield* host.client.take(key(host, `${name}-standing`), first.standing.revision) : first;
  expect(held._tag).toBe('Held');
  return host;
});
const request = (host: ProcessWorld, program: string, args: readonly string[]): LaunchRequest => ({
  command: { program, args, cwd: host.directory, environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: host.directory, dependencies: [] },
  holder: principalOf('tester'),
  origin: principalOf('tester'),
});
type StartInput = { readonly host: ProcessWorld; readonly name: string; readonly request: LaunchRequest };
const start = Effect.fnUntraced(function* ({ host, name, request }: StartInput) {
  const answer = yield* host.client.start(key(host, name), request);
  if (answer._tag !== 'Started') return yield* Effect.die(new Error(`start ${name}: ${answer._tag}`));
  return answer;
});
const lane = Effect.gen(function* () {
  const host = yield* World;
  const principal = principalOf('tester');
  const answer = yield* host.client.openBinding(principal);
  if (answer._tag !== 'Bound') return yield* Effect.die(new Error(`binding: ${answer._tag}`));
  return { binding: answer.binding, principal };
});
const environment: CommandEnvironment = {
  materialize: (request) =>
    Effect.succeed(request.entries.flatMap((entry) => (entry._tag === 'Set' ? [{ name: entry.name, value: entry.value }] : []))),
};
type SpawnInput = { readonly correlation: string; readonly stop?: CallStopping };
const makeSpawner = Effect.fnUntraced(function* ({ correlation, stop }: SpawnInput) {
  const host = yield* World;
  const context: SpawnContext = {
    installation: host.registration.installation,
    purpose: 'command',
    lifetime: 'call',
    correlation,
    target: { environment: 'e', namespace: 'n', cwd: host.directory, dependencies: [] },
    holder: principalOf('tester'),
    origin: principalOf('tester'),
    readerCredits: limits.credits,
    stop,
  };
  return yield* executionSpawner(environment, context).pipe(Effect.provide(ExecutionClient.context(host.client)));
});
const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.runCollect(stream).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString()));
const through = <E>(stream: Stream.Stream<ExecutionFeedItem, E>, marker: string) =>
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
const bytes = (host: ProcessWorld, ref: ExecutionRef, stream: 'stdout' | 'pty' = 'stdout', offset = 0n) =>
  host.client.subscribe({ _tag: 'Bytes', cursor: { ref, stream, offset: byteOffset(offset) } }, limits.credits);
const callOf = (handle: ChildProcessSpawner.ChildProcessHandle) => {
  const call = managedCall(handle);
  if (call === undefined) throw new Error('the managed handle has no call');
  return call;
};
class FixtureFailed extends Data.TaggedError('FixtureFailed')<{ readonly message: string }> {}
const failed = (cause: unknown) => new FixtureFailed({ message: String(cause) });
const command = Effect.fnUntraced(function* (argv: readonly [string, ...string[]]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(argv[0], argv.slice(1), { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const [stdout, stderr, code] = yield* Effect.all([text(child.stdout), text(child.stderr), child.exitCode], { concurrency: 3 });
  return { stdout, stderr, code: Number(code) };
}, Effect.scoped);

layer(platform, { excludeTestServices: true })('host program admission', (it) => {
  it.effect(
    'refuses malformed boots, absent native code and wrong arity before opening state',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const entry = join((yield* shared(bundleWorld, null)).root, HOST_ENTRY);
      for (const missingLibrary of [false, true]) {
        const state = yield* files.makeTempDirectoryScoped({ prefix: 'host-refused-' });
        const boot = `${state}/boot.json`;
        yield* files.writeFileString(
          boot,
          missingLibrary
            ? yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
                state,
                registration: registrationOf(state),
                library: `${state}/missing.dylib`,
                policy,
                share: hostShare(policy, 12),
                limits,
              })
            : JSON.stringify({ state, library: '/nowhere' }),
          { mode: 0o600 },
        );
        expect((yield* command([process.execPath, entry, boot])).code).not.toBe(0);
        for (const file of ['registration.json', 'executions.sqlite', 'writer.lock'])
          expect(yield* files.exists(`${state}/${file}`)).toBe(false);
      }
      for (const args of [[], ['one', 'two']]) expect((yield* command([process.execPath, entry, ...args])).code).not.toBe(0);
    }),
  );
});

layer(fixture({ policy, executions: 12, limits }), { excludeTestServices: true })('managed commands over the host wire', (it) => {
  it.effect(
    'delivers exact bytes, EOF and the child exit',
    Effect.fnUntraced(function* () {
      const host = yield* take('echo-take');
      const launched = yield* start({ host, name: 'echo', request: request(host, '/bin/echo', ['managed']) });
      const delivered = yield* Stream.runCollect(bytes(host, launched.execution));
      expect(
        delivered
          .filter((delivery) => delivery._tag === 'Bytes')
          .map((delivery) => new TextDecoder().decode(delivery.bytes))
          .join(''),
      ).toBe('managed\n');
      expect(delivered.find((delivery) => delivery._tag === 'Ended')).toEqual({ _tag: 'Ended', ending: 'completed' });
      yield* Stream.runHead(
        Stream.filter(
          host.client.subscribe({ _tag: 'State', execution: launched.execution }, limits.credits),
          (delivery) => delivery._tag === 'State' && delivery.summary.state.cleanup !== 'pending',
        ),
      );
      expect((yield* host.client.ending(launched.execution))?.nativeExit).toEqual({ _tag: 'Code', code: 0 });
    }),
  );
  it.effect(
    'admits a viewer lane and ends it atomically when custody transfers',
    Effect.fnUntraced(function* () {
      const host = yield* take('lane-take');
      const launched = yield* start({
        host,
        name: 'lane-cat',
        request: { ...request(host, '/bin/cat', []), transport: { _tag: 'pipes', stdin: 'pipe' } },
      });
      const viewer = principalOf('viewer');
      const opened = yield* host.client.openBinding(viewer);
      if (opened._tag !== 'Bound') return yield* Effect.die(new Error(`viewer: ${opened._tag}`));
      const lane = { binding: opened.binding, principal: viewer };
      expect(
        (yield* host.client.input(launched.execution, lane, {
          sequence: 0,
          cause: 'raw',
          act: { _tag: 'Write', bytes: Buffer.from('lane\n') },
        }))._tag,
      ).toBe('InputAdmitted');
      expect(yield* through(bytes(host, launched.execution), 'lane\n')).toEqual(Option.some('lane\n'));
      const summary = yield* host.client.state(launched.execution);
      expect(
        (yield* host.client.custody(
          {
            operation: key(host, 'lane-transfer'),
            execution: launched.execution,
            expected: summary?.custody.revision ?? 0,
            act: { _tag: 'Transfer', holder: principalOf('agent') },
          },
          principalOf('tester'),
        ))._tag,
      ).toBe('Accepted');
      expect(
        yield* Effect.flip(
          host.client.input(launched.execution, lane, {
            sequence: 1,
            cause: 'raw',
            act: { _tag: 'Write', bytes: Buffer.from('late\n') },
          }),
        ),
      ).toMatchObject({ _tag: 'HostRefused' });
      expect((yield* host.client.closeBinding(lane.binding, viewer))._tag).toBe('Unbound');
      expect((yield* host.client.closeBinding(lane.binding, viewer))._tag).toBe('Unbound');
      yield* host.client.stop(key(host, 'lane-stop'), launched.execution, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'continues a page from its returned cursor',
    Effect.fnUntraced(function* () {
      const host = yield* take('page-take');
      for (const name of ['page-one', 'page-two']) yield* start({ host, name, request: request(host, '/bin/echo', [name]) });
      const first = yield* host.client.list({ limit: 1 });
      if (first.after === undefined) return yield* Effect.die(new Error('the first page omitted its continuation'));
      const second = yield* host.client.list({ limit: 1, after: first.after });
      expect(first.executions).toHaveLength(1);
      expect(second.executions).toHaveLength(1);
      expect(first.executions[0]?.state.ref).toEqual(first.after);
      expect(second.executions[0]?.state.ref.execution).not.toBe(first.executions[0]?.state.ref.execution);
    }),
  );
  it.effect(
    'allows recovery reads and refuses recovery starts and pace changes',
    Effect.fnUntraced(function* () {
      const host = yield* World;
      const recovery = yield* ExecutionClient.make({
        address: { state: host.directory, installation: host.registration.installation },
        role: 'recovery',
        limits,
      });
      expect((yield* recovery.status()).installation).toBe(host.registration.installation);
      expect(yield* Effect.flip(recovery.start(key(host, 'role-start'), request(host, '/bin/echo', ['no'])))).toMatchObject({
        _tag: 'HostRefused',
        refusal: { _tag: 'Unauthorized' },
      });
      expect(yield* Effect.flip(recovery.pace('lowest'))).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'Unauthorized' } });
    }),
  );
  it.effect(
    'returns an ordinary process handle whose managed result preserves the decision',
    Effect.fnUntraced(function* () {
      yield* take('spawner-take');
      const spawner = yield* makeSpawner({ correlation: 'spawner' });
      const handle = yield* spawner.spawn(ChildProcess.make('/bin/echo', ['spawned']));
      const call = callOf(handle);
      expect(Number(handle.pid)).toBeGreaterThan(0);
      expect(yield* text(handle.stdout)).toBe('spawned\n');
      expect(Number(yield* handle.exitCode)).toBe(0);
      const result = yield* call.result;
      expect(result).toMatchObject({
        _tag: 'Decided',
        decision: { _tag: 'Completed', operation: call.operation },
        nativeExit: { _tag: 'Code', code: 0 },
      });
    }),
  );
  it.effect(
    'delivers repeated, oversized and empty writes and closes stdin at writer completion',
    Effect.fnUntraced(function* () {
      yield* take('writers-take');
      for (const chunks of [
        [Buffer.from('first\n'), Buffer.from('second\n')],
        [new Uint8Array(4 * policy.execution.input.chunkBytes + 7).fill(97)],
        [],
      ]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* makeSpawner({ correlation: `writer-${chunks.length}` });
            const handle = yield* spawner.spawn(ChildProcess.make('/bin/cat', [], { stdin: 'pipe' }));
            const reading = yield* Effect.forkScoped(text(handle.stdout));
            yield* Stream.run(Stream.fromIterable(chunks), handle.stdin);
            expect(yield* Fiber.join(reading)).toBe(Buffer.concat(chunks).toString());
            expect(Number(yield* handle.exitCode)).toBe(0);
            expect(yield* callOf(handle).result).toMatchObject({ _tag: 'Decided', decision: { _tag: 'Completed' } });
          }),
        );
      }
    }),
  );
  it.effect(
    'distinguishes a finished ending from a live execution',
    Effect.fnUntraced(function* () {
      const host = yield* take('endings-take');
      const running = yield* start({ host, name: 'ending-live', request: request(host, '/bin/sleep', ['30']) });
      expect(yield* host.client.ending(running.execution)).toBeUndefined();
      const receipt = yield* host.client.stop(key(host, 'ending-live-stop'), running.execution, 'explicit-stop', 'signal');
      expect((yield* host.client.ending(running.execution))?.nativeExit).toEqual(receipt.nativeExit);
    }),
  );
  it.effect(
    'records explicit kill, run abortion and scope close as their own causes',
    Effect.fnUntraced(function* () {
      const host = yield* take('causes-take');
      const spawner = yield* makeSpawner({ correlation: 'killed' });
      const handle = yield* spawner.spawn(ChildProcess.make('/bin/sleep', ['30']));
      yield* handle.kill();
      expect(yield* handle.isRunning).toBe(false);
      expect(yield* callOf(handle).result).toMatchObject({ _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'explicit-stop' } });
      const operations = yield* Effect.forEach(['run-abort', 'scope-closed'] as const, (cause) =>
        Effect.scoped(
          Effect.gen(function* () {
            const said = yield* Deferred.make<CallCancellation>();
            let stopped: CallCancellation | null = null;
            const stop: CallStopping = { stopped: () => stopped, stopping: Deferred.await(said) };
            const spawner = yield* makeSpawner({ correlation: cause, stop: cause === 'run-abort' ? stop : undefined });
            const handle = yield* spawner.spawn(ChildProcess.make('/bin/sleep', ['30']));
            if (cause === 'run-abort') {
              stopped = new CallCancellation(cause, 'the fixture cancelled its run');
              yield* Deferred.succeed(said, stopped);
            }
            return { cause, operation: callOf(handle).operation };
          }),
        ),
      );
      for (const { cause, operation } of operations)
        expect(yield* host.client.callResult(operation, { waitMs: 5000 })).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause } },
        });
    }),
  );
  it.effect(
    'refuses inherited streams and keeps ignored output recorded but undelivered',
    Effect.fnUntraced(function* () {
      const host = yield* take('arrangements-take');
      const spawner = yield* makeSpawner({ correlation: 'arrangements' });
      for (const child of [
        ChildProcess.make('/bin/echo', ['nowhere'], { stdout: 'inherit' }),
        ChildProcess.make('/bin/cat', [], { stdin: 'inherit' }),
      ])
        expect(yield* Effect.flip(spawner.spawn(child))).toMatchObject({ reason: { _tag: 'BadArgument', module: 'executionSpawner' } });
      const handle = yield* spawner.spawn(ChildProcess.make('/bin/echo', ['dropped'], { stdout: 'ignore' }));
      expect(yield* text(handle.stdout)).toBe('');
      expect(Number(yield* handle.exitCode)).toBe(0);
      expect(
        new TextDecoder().decode(
          (yield* host.client.read({ ref: callOf(handle).execution, stream: 'stdout', offset: byteOffset(0n) }, 64)).bytes,
        ),
      ).toBe('dropped\n');
    }),
  );
  it.effect(
    'reports kernel process evidence for a live child',
    Effect.fnUntraced(function* () {
      const host = yield* take('evidence-take');
      const launched = yield* start({ host, name: 'evidence', request: request(host, '/bin/sleep', ['30']) });
      const reading = yield* host.client.processes(launched.execution);
      expect(reading?.subject._tag).toBe('Execution');
      expect(['complete', 'partial', 'unavailable']).toContain(String(reading?.completeness));
      yield* host.client.hostListeners();
      yield* host.client.stop(key(host, 'evidence-stop'), launched.execution, 'explicit-stop', 'destroy');
    }),
  );
});

type Sampled = { readonly revision: number; readonly reading: UsageReading };
const measured = Effect.fnUntraced(function* (ref: ExecutionRef) {
  const host = yield* World;
  const inventory = yield* Stream.toPull(host.client.subscribe({ _tag: 'Inventory' }, limits.credits));
  let page = yield* host.client.commands({ limit: 8 });
  while (
    page._tag !== 'Page' ||
    !page.page.commands.some((entry) => entry.state.ref.execution === ref.execution && entry.usage !== undefined)
  ) {
    yield* inventory;
    page = yield* host.client.commands({ limit: 8 });
  }
  const reading = page.page.commands.find((entry) => entry.state.ref.execution === ref.execution)?.usage;
  if (reading === undefined) return yield* Effect.die(new Error('the sampled command has no reading'));
  return { revision: page.page.revision, reading } satisfies Sampled;
});
const frameBytes = Effect.fnUntraced(function* ({ revision, reading }: Sampled) {
  const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(HostFrame))({
    v: WIRE_VERSION,
    body: 'bytes',
    message: {
      _tag: 'Event',
      body: { _tag: 'Inventory', subscription: SubscriptionId.make(1), update: { _tag: 'Moved', revision, usage: [reading] } },
    },
  });
  return frameSize(new TextEncoder().encode(encoded).length, 0);
});
const stamp = (delivery: ExecutionFeedItem) =>
  delivery._tag === 'Inventory' && delivery.update._tag === 'Moved' ? (delivery.update.usage[0]?.takenAtMicros ?? -1) : -1;
const usage = { periodMs: 50 };
const sampledPolicy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8, usage });
const sampledLimits = hostWireLimits(sampledPolicy, 2, { envelopeBytes: 16384, connections: 4, requests: 8 });
const sampledCommand = Effect.fnUntraced(function* (name: string) {
  const host = yield* take(`${name}-take`);
  yield* Effect.forkScoped(Stream.runDrain(host.client.subscribe({ _tag: 'Load', serverPid: process.pid }, 1 << 20)));
  const answer = yield* host.client.start(key(host, name), {
    ...request(host, '/bin/sleep', ['30']),
    lifetime: 'command',
    admission: {
      origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
      limits: { executionMs: 60000, executionCeilingMs: 90000 },
      policyIdentity: 'policy-1',
    },
  });
  if (answer._tag !== 'Accepted' && answer._tag !== 'Started') return yield* Effect.die(new Error(`sampled command: ${answer._tag}`));
  return { host, ref: answer.execution, opening: yield* measured(answer.execution) };
});
layer(fixture({ policy: sampledPolicy, executions: 2, limits: sampledLimits }), { excludeTestServices: true })(
  'usage over the host wire',
  (it) => {
    it.effect(
      'carries the sampled command reading in both page forms',
      Effect.fnUntraced(function* () {
        const { host, ref } = yield* sampledCommand('usage-pages');
        const page = yield* host.client.commands({ limit: 8 });
        const batch = yield* host.client.commandsAt([ref]);
        expect(page._tag).toBe('Page');
        expect(batch.commands[0]?.usage).toBeDefined();
        if (page._tag === 'Page')
          expect(page.page.commands.find((entry) => entry.state.ref.execution === ref.execution)?.usage).toBeDefined();
        expect(batch.unmeasured.some((region) => region.detail.includes('declared no usage policy'))).toBe(false);
        yield* host.client.stop(key(host, 'usage-pages-stop'), ref, 'explicit-stop', 'destroy');
      }),
    );
    it.effect(
      'wakes a credited inventory reader on successive samples without changing its revision',
      Effect.fnUntraced(function* () {
        const { host, ref, opening } = yield* sampledCommand('usage-cadence');
        const deliveries = yield* Stream.runCollect(
          Stream.take(host.client.subscribe({ _tag: 'Inventory' }, 4 * (yield* frameBytes(opening))), 3),
        );
        const moved = deliveries.flatMap((delivery) =>
          delivery._tag === 'Inventory' && delivery.update._tag === 'Moved' ? [delivery.update] : [],
        );
        expect(moved).toHaveLength(3);
        expect(new Set(moved.map((update) => update.revision))).toEqual(new Set([opening.revision]));
        expect(stamp(deliveries[1]!)).toBeGreaterThan(stamp(deliveries[0]!));
        expect(stamp(deliveries[2]!)).toBeGreaterThan(stamp(deliveries[1]!));
        yield* host.client.stop(key(host, 'usage-cadence-stop'), ref, 'explicit-stop', 'destroy');
      }),
    );
    it.effect(
      'coalesces missed sampling rounds until a reader returns credit',
      Effect.fnUntraced(function* () {
        const { host, ref, opening } = yield* sampledCommand('usage-coalesce');
        const paused = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        const caught = yield* Deferred.make<void>();
        const deliveries: ExecutionFeedItem[] = [];
        let target = Infinity;
        const consuming = yield* Effect.forkScoped(
          Stream.runForEach(host.client.subscribe({ _tag: 'Inventory' }, 2 * (yield* frameBytes(opening))), (delivery) =>
            Effect.gen(function* () {
              deliveries.push(delivery);
              if (deliveries.length === 1) {
                yield* Deferred.succeed(paused, undefined);
                yield* Deferred.await(resume);
              }
              if (stamp(delivery) >= target) {
                yield* Deferred.succeed(caught, undefined);
                yield* Effect.never;
              }
            }),
          ),
        );
        yield* Deferred.await(paused);
        const samples = yield* Stream.toPull(host.client.subscribe({ _tag: 'Inventory' }, limits.credits));
        const after = opening.reading.takenAtMicros + 8 * usage.periodMs * 1000;
        while (target === Infinity) {
          for (const delivery of yield* samples) if (stamp(delivery) >= after) target = stamp(delivery);
        }
        yield* Deferred.succeed(resume, undefined);
        yield* Deferred.await(caught);
        yield* Fiber.interrupt(consuming);
        expect(deliveries.filter((delivery) => stamp(delivery) >= target)).toHaveLength(1);
        const rounds = Math.round((target - opening.reading.takenAtMicros) / (usage.periodMs * 1000));
        expect(deliveries.length - 1).toBeLessThan(rounds);
        yield* host.client.stop(key(host, 'usage-coalesce-stop'), ref, 'explicit-stop', 'destroy');
      }),
    );
  },
);

const terminalPolicy = hostPolicy({ executions: 1, transports: ['pty'] });
const terminalLimits = hostWireLimits(terminalPolicy, 1, { envelopeBytes: 16384, connections: 4, requests: 8 });
const frame = (delivery: ExecutionFeedItem | undefined) =>
  delivery?._tag === 'Screen' && (delivery.update._tag === 'ScreenProgramFrame' || delivery.update._tag === 'ScreenProgramPatch')
    ? delivery.update
    : undefined;
layer(fixture({ policy: terminalPolicy, executions: 1, limits: terminalLimits }), { excludeTestServices: true })(
  'terminal viewers over the host wire',
  (it) => {
    it.effect(
      'keeps independent viewer bases and sends a completed ending',
      Effect.fnUntraced(function* () {
        const host = yield* take('screen-take');
        const launched = yield* start({
          host,
          name: 'screen',
          request: {
            ...request(host, '/bin/sh', ['-c', 'printf one; read line; printf two; read line']),
            transport: { _tag: 'pty', geometry: { columns: 80, rows: 24 } },
          },
        });
        const left = yield* Stream.toPull(host.client.subscribe({ _tag: 'Screen', execution: launched.execution }, terminalLimits.credits));
        const right = yield* Stream.toPull(
          host.client.subscribe({ _tag: 'Screen', execution: launched.execution }, terminalLimits.credits),
        );
        const initial = frame((yield* left)[0]);
        const other = frame((yield* right)[0]);
        expect(initial?._tag).toBe('ScreenProgramFrame');
        expect(other?._tag).toBe('ScreenProgramFrame');
        const typing = yield* lane;
        yield* host.client.input(launched.execution, typing, {
          sequence: 0,
          cause: 'raw',
          act: { _tag: 'Write', bytes: Buffer.from('GO\n') },
        });
        const update = frame((yield* left)[0]);
        expect(update?._tag).toBe('ScreenProgramPatch');
        if (update?._tag === 'ScreenProgramPatch') expect(initial?.provenance.revision).toBe(update.provenance.base);
        yield* host.client.stop(key(host, 'screen-stop'), launched.execution, 'explicit-stop', 'destroy');
        const closing: ExecutionFeedItem[] = [];
        while (!closing.some((delivery) => delivery._tag === 'Ended')) closing.push(...(yield* left));
        expect(closing.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      }),
    );
    it.effect(
      'repaints a quiet screen and delivers byte-free grids when geometry changes',
      Effect.fnUntraced(function* () {
        const host = yield* take('grid-take');
        const launched = yield* start({
          host,
          name: 'grid',
          request: { ...request(host, '/bin/cat', []), transport: { _tag: 'pty', geometry: { columns: 80, rows: 24 } } },
        });
        const screen = yield* Stream.toPull(
          host.client.subscribe({ _tag: 'Screen', execution: launched.execution }, terminalLimits.credits),
        );
        const record = yield* Stream.toPull(bytes(host, launched.execution, 'pty'));
        expect(frame((yield* screen)[0])?.geometry).toMatchObject({ rows: 24, columns: 80 });
        const before = (yield* record)[0];
        expect(before?._tag === 'Bytes' ? [before.bytes.length, before.range.grid] : before?._tag).toEqual([0, { rows: 24, columns: 80 }]);
        expect(
          (yield* host.client.input(launched.execution, yield* lane, {
            sequence: 0,
            cause: 'resize',
            act: { _tag: 'Resize', geometry: { rows: 12, columns: 40 } },
          }))._tag,
        ).toBe('InputAdmitted');
        const after = frame((yield* screen)[0]);
        expect(after?._tag).toBe('ScreenProgramFrame');
        expect(after?.geometry).toMatchObject({ rows: 12, columns: 40 });
        const grid = (yield* record)[0];
        expect(grid?._tag === 'Bytes' ? [grid.bytes.length, grid.range.grid] : grid?._tag).toEqual([0, { rows: 12, columns: 40 }]);
        expect((yield* host.client.state(launched.execution))?.grid).toEqual({ rows: 12, columns: 40 });
        yield* host.client.stop(key(host, 'grid-stop'), launched.execution, 'explicit-stop', 'destroy');
      }),
    );
  },
);

layer(platform, { excludeTestServices: true })('host connection lifetime', (it) => {
  it.effect(
    'never displaces a live custodian and becomes vacant when its connection closes',
    Effect.fnUntraced(function* () {
      const host = yield* makeProcessWorld({ prefix: 'host-custody-', policy, limits, share: hostShare(policy, 12) });
      const beside = yield* Effect.scoped(
        Effect.gen(function* () {
          const holder = yield* ExecutionClient.make({
            address: { state: host.directory, installation: host.registration.installation },
            role: 'custodian',
            limits,
          });
          expect((yield* holder.take(key(host, 'holder-take'), 0))._tag).toBe('Held');
          return yield* host.client.take(key(host, 'probe'), 0);
        }),
      );
      expect(beside._tag).toBe('Stale');
      if (beside._tag === 'Stale') expect(beside.standing.holder?.connection).toBeDefined();
      const vacant = yield* host.client.take(key(host, 'probe-again'), 0).pipe(
        Effect.repeat({
          until: (answer) => answer._tag === 'Stale' && answer.standing.holder === undefined,
          schedule: Schedule.spaced('20 millis'),
        }),
      );
      expect(vacant._tag).toBe('Stale');
      if (vacant._tag === 'Stale') expect(vacant.standing.holder).toBeUndefined();
    }),
  );
  it.effect(
    'fails a managed handle typed when its source disappears',
    Effect.fnUntraced(function* () {
      const host = yield* makeProcessWorld({ prefix: 'host-lost-', policy, limits, share: hostShare(policy, 12) });
      expect((yield* host.client.take(key(host, 'lost-take'), 0))._tag).toBe('Held');
      const spawner = yield* makeSpawner({ correlation: 'lost' }).pipe(Effect.provideService(World, host));
      const handle = yield* spawner.spawn(ChildProcess.make('/bin/sleep', ['30']));
      const reader = yield* Processes;
      const control = yield* ProcessControl;
      const witness = reader.identity(Number(handle.pid));
      if (witness._tag !== 'Read') return yield* Effect.die(new Error('the managed child has no witness'));
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const sent = yield* control.signal(witness, 'SIGKILL');
          if (sent !== 'delivered' && sent !== 'gone' && sent !== 'changed')
            return yield* Effect.die(new Error(`lost child cleanup: ${sent}`));
          yield* control
            .standing(witness)
            .pipe(Effect.repeat({ until: (state) => state === 'gone' || state === 'changed', schedule: Schedule.spaced('10 millis') }));
        }),
      );
      const waiting = yield* Effect.forkScoped(Effect.flip(handle.exitCode));
      yield* host.crash;
      expect(yield* Fiber.join(waiting)).toMatchObject({ reason: { _tag: 'BadResource', module: 'executionSpawner' } });
    }),
  );
  it.effect(
    'reserves recovery admission at saturation and exits on recovery shutdown',
    Effect.fnUntraced(function* () {
      const held = { ...limits, connections: 1 };
      const host = yield* makeProcessWorld({ prefix: 'host-saturated-', policy, limits: held, share: hostShare(policy, 12) });
      expect((yield* host.client.take(key(host, 'take'), 0))._tag).toBe('Held');
      const other = yield* ExecutionClient.make({
        address: { state: host.directory, installation: host.registration.installation },
        role: 'custodian',
        limits,
      });
      expect(yield* Effect.flip(other.status())).toMatchObject({ _tag: 'WireFailed', fault: { kind: 'connections-exceeded' } });
      const recovery = yield* recoveryClient({ state: host.directory, installation: host.registration.installation }, limits);
      expect((yield* recovery.status()).installation).toBe(host.registration.installation);
      expect((yield* recovery.changes(0, 200))._tag).toBe('Changed');
      expect((yield* recovery.shutdown(key(host, 'shutdown')))._tag).toBe('ShutdownComplete');
      yield* host.child.exitCode;
    }),
  );
  it.effect(
    'admits successive managed children on one slot',
    Effect.fnUntraced(function* () {
      const policy = hostPolicy({ executions: 1, transports: ['pipes'] });
      const host = yield* makeProcessWorld({ prefix: 'host-slot-', policy, limits, share: hostShare(policy, 1) });
      expect((yield* host.client.take(key(host, 'take'), 0))._tag).toBe('Held');
      for (const word of ['first', 'second'])
        yield* Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* makeSpawner({ correlation: word }).pipe(Effect.provideService(World, host));
            const handle = yield* spawner.spawn(ChildProcess.make('/bin/echo', [word]));
            expect(yield* text(handle.stdout)).toBe(`${word}\n`);
            expect(Number(yield* handle.exitCode)).toBe(0);
          }),
        );
    }),
  );
});

type RuleInput = {
  readonly host: ProcessWorld;
  readonly line: string;
  readonly limits: CommandLimits;
  readonly words: readonly [string, ...string[]];
  readonly limitMs: number;
  readonly id: string;
};
const ruled = ({ host, line, limits, words, limitMs, id }: RuleInput): LaunchRequest => ({
  ...request(host, '/bin/sh', ['-c', line]),
  lifetime: 'command',
  admission: {
    origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
    limits,
    policyIdentity: 'policy-1',
    programs: {
      root: host.directory,
      rules: [{ id, program: { words }, limitMs, writer: 'tester', at: '1970-01-01T00:00:00.000Z', words: id }],
    },
  },
});
type DecisionInput = { readonly name: string; readonly request: LaunchRequest; readonly resume?: string };
const decided = Effect.fnUntraced(function* ({ name, request, resume }: DecisionInput) {
  const host = yield* take(`${name}-take`);
  const answer = yield* host.client.start(
    key(host, name),
    resume === undefined ? request : { ...request, transport: { _tag: 'pipes', stdin: 'pipe' } },
  );
  if (answer._tag !== 'Accepted' && answer._tag !== 'Started') return yield* Effect.die(new Error(`ruled command: ${answer._tag}`));
  if (resume !== undefined) {
    yield* Stream.runHead(
      Stream.filter(
        host.client.subscribe({ _tag: 'State', execution: answer.execution }, limits.credits),
        (delivery) => delivery._tag === 'State' && delivery.summary.processes?.rulings.some((ruling) => ruling._tag === 'Ended') === true,
      ),
    );
    yield* host.client.input(answer.execution, yield* lane, {
      sequence: 0,
      cause: 'raw',
      act: { _tag: 'Write', bytes: Buffer.from(resume) },
    });
  }
  const delivery = yield* Stream.runHead(
    Stream.filter(
      host.client.subscribe({ _tag: 'State', execution: answer.execution }, limits.credits),
      (delivery) => delivery._tag === 'State' && delivery.summary.decision !== undefined,
    ),
  );
  if (delivery._tag !== 'Some' || delivery.value._tag !== 'State')
    return yield* Effect.die(new Error('the ruled command ended without a decision'));
  return delivery.value.summary;
});
layer(fixture({ policy, executions: 12, limits }), { excludeTestServices: true })('program rules over actual children', (it) => {
  it.effect(
    'ends a matched process at its own limit while its command resumes to completion',
    Effect.fnUntraced(function* () {
      const host = yield* World;
      const answer = yield* decided({
        name: 'rule-sleep',
        request: ruled({
          host,
          line: 'sleep 31; read wake; echo after',
          limits: { executionMs: 60000, origin: 'caller' },
          id: 'sleep',
          words: ['sleep', '31'],
          limitMs: 200,
        }),
        resume: 'GO\n',
      });
      expect(answer.decision?._tag).toBe('Completed');
      expect(answer.state.nativeExit).toEqual({ _tag: 'Code', code: 0 });
      expect(answer.processes?.rulings.map((ruling) => [ruling._tag, 'rule' in ruling ? ruling.rule.id : undefined])).toEqual([
        ['Ended', 'sleep'],
      ]);
    }),
  );
});

const childOf = Effect.fnUntraced(function* (pid: number) {
  const found = (yield* command(['pgrep', '-P', String(pid)])).stdout.trim().split('\n')[0];
  return yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(found);
});
const backgrounds = (pids: readonly number[]) => Effect.forEach(pids, background);
type PaceInput = { readonly name: string; readonly line: string; readonly paced: boolean; readonly input?: boolean };
const paced = Effect.fnUntraced(function* ({ name, line, paced, input = false }: PaceInput) {
  const host = yield* World;
  const answer = yield* Effect.acquireRelease(
    start({
      host,
      name,
      request: {
        ...request(host, '/bin/sh', ['-c', line]),
        paced: paced ? true : undefined,
        transport: { _tag: 'pipes', stdin: input ? 'pipe' : 'ignore' },
      },
    }),
    (answer) => host.client.stop(key(host, `${name}-cleanup`), answer.execution, 'explicit-stop', 'destroy').pipe(Effect.orDie),
  );
  if (answer.native.pid === undefined) return yield* Effect.die(new Error('the paced execution has no pid'));
  yield* through(bytes(host, answer.execution), 'READY\n');
  return { ref: answer.execution, pid: answer.native.pid };
});
layer(fixture({ policy, executions: 12, limits }), { excludeTestServices: true })('agent-work pace over actual children', (it) => {
  it.effect(
    'backgrounds paced descendants, preserves unpaced work and raises live work to full',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-lowest-take');
      expect(yield* host.client.pace('lowest')).toEqual({ _tag: 'Applied', pace: 'lowest', reached: 0, kept: 0, failed: 0 });
      const held = yield* paced({ name: 'pace-lowest', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const unpaced = yield* Effect.acquireRelease(
        start({ host, name: 'pace-unpaced', request: request(host, '/bin/sleep', ['30']) }),
        (answer) => host.client.stop(key(host, 'pace-unpaced-cleanup'), answer.execution, 'explicit-stop', 'destroy').pipe(Effect.orDie),
      );
      if (unpaced.native.pid === undefined) return yield* Effect.die(new Error('the unpaced process has no pid'));
      const child = yield* childOf(held.pid);
      const pids = [held.pid, child, unpaced.native.pid];
      expect(yield* backgrounds(pids)).toEqual([true, true, false]);
      const before = (yield* host.client.commandsAt([held.ref])).revision;
      expect(yield* host.client.pace('full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 2, kept: 0, failed: 0 });
      expect(yield* backgrounds(pids)).toEqual([false, false, false]);
      const changed = yield* host.client.changes(before, 8);
      expect(changed._tag === 'Changed' ? changed.executions.map((summary) => summary.state.ref.execution) : changed).toContain(
        held.ref.execution,
      );
      yield* host.client.pace('lowest');
      expect(yield* backgrounds(pids)).toEqual([true, true, false]);
      yield* host.client.pace('full');
      yield* host.client.stop(key(host, 'pace-lowest-stop'), held.ref, 'explicit-stop', 'destroy');
      yield* host.client.stop(key(host, 'pace-unpaced-stop'), unpaced.execution, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'applies a full move while running utility work keeps its level, and applies supported lower moves',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-low-take');
      yield* host.client.pace('low');
      const held = yield* paced({ name: 'pace-low', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const child = yield* childOf(held.pid);
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      expect(yield* host.client.pace('full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 0, kept: 2, failed: 0 });
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.pace('lowest');
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('low');
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.stop(key(host, 'pace-low-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'backgrounds a live command and the descendant it starts afterward',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-running-take');
      yield* host.client.pace('full');
      const held = yield* paced({
        name: 'pace-running',
        line: "echo READY; read wake; sh -c 'echo READY; exec sleep 30'; :",
        paced: true,
        input: true,
      });
      expect(yield* background(held.pid)).toBe(false);
      expect(yield* host.client.pace('lowest')).toEqual({ _tag: 'Applied', pace: 'lowest', reached: 1, kept: 0, failed: 0 });
      yield* host.client.input(held.ref, yield* lane, { sequence: 0, cause: 'raw', act: { _tag: 'Write', bytes: Buffer.from('GO\n') } });
      yield* through(bytes(host, held.ref, 'stdout', 6n), 'READY\n');
      const child = yield* childOf(held.pid);
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('full');
      yield* host.client.stop(key(host, 'pace-running-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'keeps lowest-born work at lowest on a low move and still permits full',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-eased-take');
      yield* host.client.pace('lowest');
      const held = yield* paced({ name: 'pace-eased', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const child = yield* childOf(held.pid);
      expect(yield* host.client.pace('low')).toEqual({ _tag: 'Applied', pace: 'low', reached: 0, kept: 2, failed: 0 });
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('full');
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.stop(key(host, 'pace-eased-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
});

layer(platform, { excludeTestServices: true })('detached host launcher', (it) => {
  it.effect(
    'survives the live launching process group being killed',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'host-detached-' });
      const registration = registrationOf(state);
      const boot = `${state}/boot.json`;
      yield* files.writeFileString(
        boot,
        yield* Schema.encodeEffect(Schema.fromJsonString(HostBoot))({
          state,
          registration,
          library: HOLDER_LIBRARY,
          policy,
          share: hostShare(policy, 12),
          limits,
          lifetime: 'detached',
        }),
        { mode: 0o600 },
      );
      const entry = `${state}/launcher.mjs`;
      yield* files.writeFileString(
        entry,
        `const child=Bun.spawn([process.execPath,${JSON.stringify(`${import.meta.dir}/hostLaunch.ts`)},${JSON.stringify(boot)}],{stdin:'ignore',stdout:'pipe',stderr:'inherit'}); const output=await new Response(child.stdout).text(); if(await child.exited)process.exit(1); console.log(output.trim()); setInterval(()=>{},1000);`,
      );
      const parent = yield* Effect.acquireRelease(
        Effect.try({
          try: () => spawnDetached(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }),
          catch: failed,
        }),
        (parent) =>
          Effect.sync(() => {
            if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
          }),
      );
      const output = Stream.fromAsyncIterable(parent.stdout, failed).pipe(Stream.decodeText(), Stream.splitLines);
      expect(yield* Stream.runHead(output)).toEqual(Option.some('Started'));
      if (parent.pid === undefined) return yield* failed('the launching process has no pid');
      const client = yield* ExecutionClient.make({
        address: { state, installation: registration.installation },
        role: 'custodian',
        limits,
      });
      yield* Effect.addFinalizer(() =>
        Effect.scoped(
          Effect.gen(function* () {
            const recovery = yield* recoveryClient({ state, installation: registration.installation }, limits);
            expect(
              (yield* recovery.shutdown({ installation: registration.installation, operation: HostRequestKey.make('shutdown') }))._tag,
            ).toBe('ShutdownComplete');
            yield* writerClaimAvailable(state).pipe(Effect.repeat({ until: Boolean, schedule: Schedule.spaced('20 millis') }));
          }),
        ).pipe(Effect.orDie),
      );
      expect((yield* client.status()).installation).toBe(registration.installation);
      yield* Effect.try({ try: () => process.kill(-parent.pid!, 'SIGKILL'), catch: failed });
      expect((yield* client.status()).installation).toBe(registration.installation);
      expect((yield* client.take({ installation: registration.installation, operation: HostRequestKey.make('take') }, 0))._tag).toBe(
        'Held',
      );
    }),
  );
});
