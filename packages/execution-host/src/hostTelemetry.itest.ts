import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber, FileSystem, Metric, Option, Schedule, Stream, Tracer } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import * as Hex from 'effect/encoding/Hex';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { ExecutionClient, type Client } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { serve } from './composition/host';
import { HOLDER_LIBRARY, testHolder } from './posix/testing/holder';
import { hostPolicy, hostShare, hostWireLimits, registrationOf } from './hostFixture';
import { type HostTelemetryOptions, exhausted, readBytes, reads, refusals } from './hostTelemetry';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 4, requests: 8 });
const share = hostShare(policy, 2);
const principal = Principal.make('tester');
const launch = (cwd: string, program: string, args: readonly string[]): LaunchRequest => ({
  command: { program, args, environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd, dependencies: [] },
  holder: principal,
  origin: principal,
});
type CollectedSpan = {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentId: string | undefined;
  readonly name: string;
  readonly attributes: Map<string, unknown>;
  exit: Exit.Exit<unknown, unknown> | undefined;
};
const collectSpans = () => {
  const spans: CollectedSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const parent = Option.getOrUndefined(options.parent);
      const spanId = Hex.random(16);
      const record: CollectedSpan = {
        spanId,
        traceId: parent?.traceId ?? Hex.random(32),
        parentId: parent?.spanId,
        name: options.name,
        attributes: new Map(),
        exit: undefined,
      };
      spans.push(record);
      return {
        _tag: 'Span',
        spanId,
        traceId: record.traceId,
        name: options.name,
        parent: options.parent,
        annotations: options.annotations,
        attributes: record.attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        status: { _tag: 'Started', startTime: options.startTime },
        attribute(key: string, value: unknown) {
          record.attributes.set(key, value);
        },
        event() {},
        addLinks() {},
        end(_endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
          record.exit = exit;
        },
      };
    },
  });
  return { tracer, spans };
};
type TelemetryWorld = {
  readonly executions: Client;
  readonly spans: CollectedSpan[];
  readonly directory: string;
  readonly key: (name: string) => HostRequestRef;
};
type Telemetry = { readonly tracer?: boolean; readonly telemetry?: HostTelemetryOptions };
type TelemetryCase<A, E, R> = {
  readonly work: (world: TelemetryWorld) => Effect.Effect<A, E, R>;
  readonly options?: Telemetry;
  readonly unwritable?: boolean;
};
const over = Effect.fnUntraced(function* <A, E, R>({ work, options = {}, unwritable = false }: TelemetryCase<A, E, R>) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'host-telemetry-' });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      if (unwritable) {
        const path = `${directory}/performance`;
        yield* files.makeDirectory(path, { mode: 0o700 });
        yield* Effect.acquireRelease(files.chmod(path, 0), () => Effect.orDie(files.chmod(path, 0o700)));
      }
      const registration = registrationOf(directory);
      const collected = collectSpans();
      const serving = serve(
        { state: directory, registration, library: HOLDER_LIBRARY, policy, share, limits },
        { telemetry: options.telemetry },
      ).pipe(Effect.provide(testHolder(directory)));
      const running = yield* Effect.forkScoped(options.tracer === false ? serving : serving.pipe(Effect.withTracer(collected.tracer)));
      const executions = yield* ExecutionClient.make({
        address: { state: directory, installation: registration.installation },
        role: 'custodian',
        limits,
      });
      yield* Effect.raceFirst(
        executions.status().pipe(
          Effect.retry({
            while: (failure) => failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable'),
            schedule: Schedule.spaced('25 millis'),
          }),
        ),
        Fiber.join(running).pipe(Effect.andThen(Effect.die(new Error('the telemetry host stopped before its first status')))),
      );
      const key = (name: string) => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      const took = yield* executions.take(key('telemetry-take'), 0);
      if (took._tag !== 'Held') return yield* Effect.die(new Error(`custody: ${took._tag}`));
      return yield* work({ executions, spans: collected.spans, directory, key });
    }),
  ).pipe(
    Effect.provide(HostRegistration.layer),
    Effect.provide(endpointConnection),
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
});

const script = Effect.fnUntraced(function* ({ executions, directory, key }: TelemetryWorld) {
  const started = yield* executions.start(key('script-start'), launch(directory, '/bin/sh', ['-c', 'echo ready; exec cat']));
  if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
  const execution = started.execution;
  const at = (offset: bigint) => ({ ref: execution, stream: 'stdout' as const, offset: byteOffset(offset) });
  yield* Stream.runHead(executions.subscribe({ _tag: 'Bytes', cursor: at(0n) }, limits.credits));
  const served = yield* executions.read(at(0n), 1024);
  const refused = yield* Effect.flip(executions.read(at(1_000_000n), 1024));
  const stopped = yield* executions.stop(key('script-stop'), execution, 'explicit-stop', 'signal');
  const ending = yield* executions.ending(execution);
  return {
    started: started._tag,
    servedBytes: new TextDecoder().decode(served.bytes),
    servedGap: served.range.gap,
    refused: refused._tag,
    stoppedRelation: stopped.relation,
    stoppedLeader: stopped.coverage.includes('leader'),
    stoppedWork: stopped.coverage.includes('work'),
    stoppedCleanup: stopped.cleanup,
    stoppedResidual: stopped.residual.length,
    stoppedUnverifiable: stopped.unverifiable.length,
    stoppedCause: stopped.cause,
    ended: ending === undefined ? 'none' : ending.relation,
  };
});

layer(BunServices.layer, { excludeTestServices: true })('the host answers observably', (it) => {
  it.effect('wire spans and counters name refused subscriptions and reads, and preserve a keystroke trace ancestry', () =>
    over({
      work: Effect.fnUntraced(function* ({ executions, spans, directory, key }) {
        const started = yield* executions.start(key('telemetry-start'), launch(directory, '/bin/sh', ['-c', 'echo hello; exec sleep 30']));
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const execution = started.execution;
        const cursor = { ref: execution, stream: 'stdout' as const, offset: byteOffset(0n) };
        const hold = Effect.fnUntraced(function* () {
          const seen = yield* Deferred.make<void>();
          yield* Effect.forkScoped(
            Stream.runDrain(
              Stream.tap(executions.subscribe({ _tag: 'Bytes', cursor }, limits.credits), () => Deferred.succeed(seen, undefined)),
            ),
          );
          yield* Deferred.await(seen);
        });
        yield* hold();
        yield* hold();
        const refusedSubscription = yield* Effect.flip(Stream.runDrain(executions.subscribe({ _tag: 'Bytes', cursor }, limits.credits)));
        expect(refusedSubscription._tag).toBe('HostRefused');
        if (refusedSubscription._tag !== 'HostRefused') return yield* Effect.die(new Error(`subscription: ${refusedSubscription._tag}`));
        expect(refusedSubscription.refusal._tag).toBe('CapacityExceeded');
        yield* executions.stop(key('telemetry-stop'), execution, 'explicit-stop', 'signal');
        const setup = spans.filter((span) => span.name === 'Host.Subscribe' && span.attributes.get('refusal') !== undefined);
        expect(setup).toHaveLength(1);
        expect(Object.fromEntries(setup[0]?.attributes ?? new Map())).toMatchObject({
          executionId: execution.execution,
          incarnation: 0,
          role: 'custodian',
          refusal: 'CapacityExceeded',
          refusalReason: refusedSubscription.refusal.reason,
        });
        expect(typeof setup[0]?.attributes.get('connectionId')).toBe('string');
        expect((yield* Metric.value(Metric.withAttributes(refusals, { refusal: 'CapacityExceeded' }))).count).toBeGreaterThanOrEqual(1);
        expect((yield* Metric.value(Metric.withAttributes(exhausted, { budget: 'execution.read.readers' }))).count).toBeGreaterThanOrEqual(
          1,
        );

        const readStart = yield* executions.start(key('read-start'), launch(directory, '/bin/sh', ['-c', 'echo hello; exec sleep 30']));
        if (readStart._tag !== 'Started') return yield* Effect.die(new Error(`start: ${readStart._tag}`));
        const at = (offset: bigint) => ({ ref: readStart.execution, stream: 'stdout' as const, offset: byteOffset(offset) });
        yield* Stream.runHead(executions.subscribe({ _tag: 'Bytes', cursor: at(0n) }, limits.credits));
        const served = yield* executions.read(at(0n), 1024);
        expect(served.bytes.length).toBeGreaterThan(0);
        expect((yield* Effect.flip(executions.read(at(1_000_000n), 1024)))._tag).toBe('HostRefused');
        yield* executions.stop(key('read-stop'), readStart.execution, 'explicit-stop', 'signal');
        expect((yield* Metric.value(Metric.withAttributes(reads, { outcome: 'answered' }))).count).toBeGreaterThanOrEqual(1);
        expect((yield* Metric.value(readBytes)).count).toBeGreaterThanOrEqual(served.bytes.length);
        const servedSpans = spans.filter((span) => span.name === 'Host.Read' && span.attributes.get('refusal') === undefined);
        const refusedSpans = spans.filter((span) => span.name === 'Host.Read' && span.attributes.get('refusal') !== undefined);
        expect(servedSpans).toHaveLength(1);
        expect(servedSpans[0]?.attributes.get('bytes')).toBe(served.bytes.length);
        expect(servedSpans[0]?.attributes.get('role')).toBe('custodian');
        expect(refusedSpans).toHaveLength(1);
        expect(refusedSpans[0]?.attributes.get('refusal')).toBe('HostConflict');
        expect(typeof refusedSpans[0]?.attributes.get('refusalReason')).toBe('string');
        expect(refusedSpans[0]?.attributes.get('role')).toBe('custodian');

        const typed = 'typed\n';
        const typedStart = yield* executions.start(key('trace-start'), {
          ...launch(directory, '/bin/cat', []),
          transport: { _tag: 'pipes', stdin: 'pipe' },
        });
        if (typedStart._tag !== 'Started') return yield* Effect.die(new Error(`start: ${typedStart._tag}`));
        const bound = yield* executions.openBinding(principal);
        if (bound._tag !== 'Bound') return yield* Effect.die(new Error(`binding: ${bound._tag}`));
        const admitted = yield* executions.input(
          typedStart.execution,
          { binding: bound.binding, principal },
          { sequence: 0, cause: 'raw', act: { _tag: 'Write', bytes: new TextEncoder().encode(typed) } },
        );
        expect(admitted._tag).toBe('InputAdmitted');
        yield* executions.stop(key('trace-stop'), typedStart.execution, 'explicit-stop', 'signal');
        const admission = spans.find((span) => span.name === 'admitInput');
        expect(admission?.attributes.get('kind')).toBe('Write');
        expect(admission?.attributes.get('bytes')).toBe(typed.length);
        const trace = spans.filter((span) => span.traceId === admission?.traceId);
        const verb = trace.find((span) => span.name === 'Host.Input');
        const dispatch = trace.find((span) => span.spanId === verb?.parentId);
        const take = trace.find((span) => span.spanId === dispatch?.parentId);
        expect(take?.name).toBe('wire.framereader.take');
        expect(take?.attributes.get('bytes')).toBeGreaterThan(0);
        expect(dispatch?.name).toBe('wire.read.dispatch');
        expect(dispatch?.attributes.get('kind')).toBe('Call');
        expect(dispatch?.attributes.get('bytes')).toBeGreaterThan(0);
        expect(trace.find((span) => span.spanId === admission?.parentId)?.name).toBe('Host.Input');
        expect(verb?.attributes.get('executionId')).toBe(typedStart.execution.execution);
      }),
    }),
  );

  it.effect('telemetry saturation and an unopenable store preserve the same public answers', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const saturated = yield* over({
        work: Effect.fnUntraced(function* (world) {
          return { answers: yield* script(world), directory: world.directory };
        }),
        options: {
          tracer: false,
          telemetry: {
            recordFloorMicros: 0,
            maxStoredBytes: () => 4 * 1024,
            maxPendingBytes: () => 16 * 1024,
            vitalsIntervalMs: () => 1_000_000,
            metricsIntervalMs: () => 1_000_000,
          },
        },
      });
      const unwritable = yield* over({
        work: Effect.fnUntraced(function* (world) {
          return { answers: yield* script(world), directory: world.directory };
        }),
        options: {
          tracer: false,
          telemetry: { recordFloorMicros: 0, vitalsIntervalMs: () => 1_000_000, metricsIntervalMs: () => 1_000_000 },
        },
        unwritable: true,
      });
      expect(unwritable.answers).toEqual(saturated.answers);
      expect(saturated.answers).toEqual({
        started: 'Started',
        servedBytes: 'ready\n',
        servedGap: false,
        refused: 'HostRefused',
        stoppedRelation: 'covered',
        stoppedLeader: true,
        stoppedWork: true,
        stoppedCleanup: 'complete',
        stoppedResidual: 0,
        stoppedUnverifiable: 0,
        stoppedCause: 'explicit-stop',
        ended: 'covered',
      });
      const segments = `${saturated.directory}/performance/segments`;
      const sizes = yield* Effect.forEach(yield* files.readDirectory(segments), (name) =>
        Effect.map(files.stat(`${segments}/${name}`), (info) => Number(info.size)),
      );
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(4 * 1024);
      expect(yield* files.readDirectory(`${unwritable.directory}/performance`)).toEqual([]);
    }),
  );
});
