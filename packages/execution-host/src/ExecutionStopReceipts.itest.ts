import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Deferred, Effect, FileSystem, Layer, Ref } from 'effect';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import { Principal } from '@runlith/executions/protocol/custody';
import { InstallationId, ExecutionId, type ExecutionRef, type NativeExit } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { type NativeEnding, type RecordFacts, type StopTarget, type ExecutionStop, makeExecutionStop } from './ExecutionStop';
import { ExecutionCapacity } from './ExecutionCapacity';
import { type ExecutionInput, InputActUnsupported, type InputSink, makeExecutionInput } from './ExecutionInput';
import { ExecutionStore, executionStore } from './store/ExecutionStore';
import type { LaunchRequest } from './store/records';
import { INSTALLATION, fixtureHolder, hostProfile, keyOf, registrationOf, signalConnection } from './hostFixture';
import { admit } from './runtimeFixture';

const profile = hostProfile({ executions: 6 });
const ref = (execution: string, incarnation = 0): ExecutionRef => ({
  installation: InstallationId.make(INSTALLATION),
  execution: ExecutionId.make(execution),
  incarnation,
});
const launch = (identity: ExecutionRef, key: string): LaunchRequest => ({
  operation: keyOf(key),
  fingerprint: `command:echo ${identity.execution}`,
  ref: identity,
  transport: 'pipes',
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: Principal.make('principal-operator'),
  origin: Principal.make('principal-operator'),
  receipt: { _tag: 'Accepted', execution: identity },
});
const fixture = Layer.unwrap(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-stop-' });
    return executionStore(
      `${directory}/executions.sqlite`,
      registrationOf(directory),
      new ProcessPool(undefined, 'stop', undefined, childHosting),
    ).pipe(Layer.provide(fixtureHolder()), Layer.provideMerge(ExecutionCapacity.layer(profile)));
  }),
).pipe(Layer.provideMerge(BunServices.layer));
const takingSink: InputSink = {
  initiallyClosed: false,
  write: (bytes) => Effect.succeed(bytes.length),
  stop: Effect.void,
  interrupt: () => Effect.fail(new InputActUnsupported({ act: 'interrupt', reason: 'transport', detail: 'no line discipline' })),
  resize: () => Effect.fail(new InputActUnsupported({ act: 'resize', reason: 'transport', detail: 'no geometry' })),
  end: { _tag: 'Closes', close: () => Effect.void },
};
const parkedSink = () => {
  const taking = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const sink: InputSink = {
    ...takingSink,
    write: (bytes) => Effect.as(Effect.andThen(Deferred.succeed(taking, undefined), Deferred.await(release)), bytes.length),
  };
  return { taking, release, sink };
};
type EndingSequence = readonly [NativeEnding, ...NativeEnding[]];
type TargetInput = { readonly endings: EndingSequence; readonly relations?: readonly NativeRelation[] };
const target = ({ endings, relations = ['leader'] }: TargetInput): StopTarget => {
  let taken = 0;
  return {
    relations,
    identity: () => Effect.succeed({ pid: 4242 }),
    end: () => Effect.succeed(endings[Math.min(taken++, endings.length - 1)]!),
    signal: () => Effect.succeed({ delivered: true, pid: 4242, reason: undefined, detail: '' }),
  };
};
const ENDED: NativeEnding = {
  exit: { _tag: 'Code', code: 0 },
  measured: ['leader'],
  confirmed: [{ pid: 4242, relation: 'leader', exit: { _tag: 'Code', code: 0 }, step: 'interrupt' }],
  residual: [],
  unverifiable: [],
  abandonedOutput: false,
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this backend reads no accounting' },
  steps: ['interrupt'],
};
const ACCOUNTED: NativeEnding = { ...ENDED, cost: { _tag: 'Measured', cpuMicros: 67_825, peakRssBytes: 2_015_232 } };
const UNMEASURED: NativeEnding = {
  exit: undefined,
  measured: [],
  confirmed: [],
  residual: [],
  unverifiable: [],
  abandonedOutput: false,
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this backend reads no accounting' },
  steps: ['interrupt', 'terminate', 'kill'],
};
const facts: RecordFacts = {
  streams: () => Effect.succeed([{ stream: 'stdout', ending: 'eof' }]),
  sources: () =>
    Effect.succeed({ stdout: { completed: true, offset: byteOffset(0n) }, stderr: { completed: true, offset: byteOffset(0n) } }),
  retention: () => Effect.succeed('retained'),
  observedExit: () => Effect.succeed(undefined),
  unrecorded: () => Effect.succeed([]),
};
type StopWorld = { readonly stop: ExecutionStop; readonly input: ExecutionInput; readonly store: ExecutionStore['Service'] };
type StopCase<A, E, R> = {
  readonly execution: string;
  readonly endings: EndingSequence;
  readonly sink?: InputSink;
  readonly facts?: RecordFacts;
  readonly relations?: readonly NativeRelation[];
  readonly body: (world: StopWorld) => Effect.Effect<A, E, R>;
};
const withStop = Effect.fnUntraced(function* <A, E, R>({
  execution,
  endings,
  sink = takingSink,
  facts: record = facts,
  relations,
  body,
}: StopCase<A, E, R>) {
  const capacity = yield* ExecutionCapacity;
  const store = yield* ExecutionStore;
  const identity = ref(execution, (yield* store.incarnation()).incarnation);
  yield* Effect.acquireRelease(capacity.reserve(identity.execution, 'pipes'), () => capacity.release(identity.execution));
  yield* store.reserve(launch(identity, `start-${execution}`));
  const input = yield* makeExecutionInput({ sink, limits: profile.execution, ref: identity, announce: Effect.void });
  const stop = yield* makeExecutionStop({ input, target: target({ endings, relations }), facts: record, ref: identity });
  return yield* body({ stop, input, store });
}, Effect.scoped);
const bytes = (text: string) => new TextEncoder().encode(text);

layer(fixture, { excludeTestServices: true })('a stop receipt keeps its populations apart', (it) => {
  it.effect('carries measured accounting and never invents accounting the backend did not read', () =>
    Effect.gen(function* () {
      const accounted = yield* withStop({
        execution: 'exec-cost-read',
        endings: [ACCOUNTED],
        body: ({ stop }) => stop.stop(keyOf('stop-cost-read'), 'explicit-stop', 'signal'),
      });
      expect(accounted.cost).toEqual({ _tag: 'Measured', cpuMicros: 67_825, peakRssBytes: 2_015_232 });
      const silent = yield* withStop({
        execution: 'exec-cost-none',
        endings: [ENDED],
        body: ({ stop }) => stop.stop(keyOf('stop-cost-none'), 'explicit-stop', 'signal'),
      });
      expect(silent.cost).toMatchObject({ _tag: 'Unmeasured', reason: 'unsupported' });
    }),
  );

  it.effect('reports queued and uncertain in-flight input separately while cleanup follows the native ending', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      const receipt = yield* withStop({
        execution: 'exec-owed',
        sink: child.sink,
        endings: [ENDED],
        body: Effect.fnUntraced(function* ({ stop, input }) {
          yield* admit(input, { sequence: 0, cause: 'typed', act: { _tag: 'Write', bytes: bytes('inflight') } });
          yield* Deferred.await(child.taking);
          yield* admit(input, { sequence: 1, cause: 'typed', act: { _tag: 'Write', bytes: bytes('queued') } });
          const receipt = yield* stop.stop(keyOf('stop-owed'), 'explicit-stop', 'destroy');
          yield* Deferred.succeed(child.release, undefined);
          return receipt;
        }),
      });
      expect(receipt.residual.map((row) => row.kind)).toEqual(['record']);
      expect(receipt.residual[0]?.detail).toContain('6');
      expect(receipt.unverifiable.map((row) => row.kind)).toEqual(['record']);
      expect(receipt.unverifiable[0]?.detail).toContain('8');
      expect(receipt.cleanup).toBe('complete');
      expect(receipt.confirmed).toHaveLength(1);
    }),
  );

  it.effect('revises a late witnessed ending without losing input debt from its earlier measurement', () =>
    Effect.gen(function* () {
      const child = parkedSink();
      const waiting: NativeEnding = {
        ...UNMEASURED,
        residual: [{ kind: 'process', pid: 4242, relation: 'leader', detail: 'the leader was not observed ending' }],
      };
      yield* withStop({
        execution: 'exec-late-witness',
        sink: child.sink,
        endings: [waiting],
        body: Effect.fnUntraced(function* ({ stop, input }) {
          yield* admit(input, { sequence: 0, cause: 'typed', act: { _tag: 'Write', bytes: bytes('inflight') } });
          yield* Deferred.await(child.taking);
          yield* admit(input, { sequence: 1, cause: 'typed', act: { _tag: 'Write', bytes: bytes('queued') } });
          const earlier = yield* stop.stop(keyOf('stop-late-witness'), 'explicit-stop', 'destroy');
          yield* Deferred.succeed(child.release, undefined);
          yield* stop.noteUnmeasurable({ kind: 'process', detail: 'the leader ended', reason: 'its wait owner was lost' }, UNMEASURED);
          const final = yield* stop.measured;
          expect(earlier.residual.map((row) => row.kind)).toEqual(['record', 'process']);
          expect(final?.residual.map((row) => row.kind)).toEqual(['record']);
          expect(final?.unverifiable.some((row) => row.kind === 'record')).toBe(true);
          expect(final?.unverifiable.some((row) => row.kind === 'process')).toBe(true);
          expect(final?.cost._tag).toBe('Unmeasured');
        }),
      });
    }),
  );

  it.effect('claims a relation only after positive measurement', () =>
    Effect.gen(function* () {
      const unknown = yield* withStop({
        execution: 'exec-unknown',
        endings: [UNMEASURED],
        body: ({ stop }) => stop.stop(keyOf('stop-unknown'), 'explicit-stop', 'signal'),
      });
      const measured = yield* withStop({
        execution: 'exec-leader',
        endings: [ENDED],
        body: ({ stop }) => stop.stop(keyOf('stop-leader'), 'explicit-stop', 'destroy'),
      });
      expect(unknown.relation).toBe('unknown');
      expect(unknown.cleanup).toBe('unverifiable');
      expect(unknown.unverifiable.map((row) => row.kind)).toEqual(['process']);
      expect(measured.relation).toBe('leader');
      expect(measured.cleanup).toBe('complete');
    }),
  );

  it.effect('claims group coverage from the measured ending rather than the backend ability to identify a group', () =>
    Effect.gen(function* () {
      const group: readonly NativeRelation[] = ['leader', 'work'];
      const exit: NativeExit = { _tag: 'Code', code: 0 };
      const leader = { pid: 4242, relation: 'leader', exit } as const;
      const unproven = yield* withStop({
        execution: 'exec-group-unproven',
        relations: group,
        endings: [{ ...ENDED, confirmed: [leader] }],
        body: ({ stop }) => stop.stop(keyOf('stop-group-unproven'), 'explicit-stop', 'signal'),
      });
      const covered = yield* withStop({
        execution: 'exec-group-covered',
        relations: group,
        endings: [{ ...ENDED, measured: group, confirmed: [leader, { pid: 4242, relation: 'work', exit }] }],
        body: ({ stop }) => stop.stop(keyOf('stop-group-covered'), 'explicit-stop', 'signal'),
      });
      const surviving = yield* withStop({
        execution: 'exec-group-partial',
        relations: group,
        endings: [
          {
            ...ENDED,
            measured: group,
            confirmed: [leader],
            residual: [{ kind: 'process', detail: 'the group still holds work', pid: 4242, relation: 'work' }],
          },
        ],
        body: ({ stop }) => stop.stop(keyOf('stop-group-partial'), 'explicit-stop', 'signal'),
      });
      expect(unproven.coverage).toEqual(['leader']);
      expect(unproven.relation).toBe('leader');
      expect(unproven.cleanup).toBe('complete');
      expect(covered.relation).toBe('covered');
      expect(covered.cleanup).toBe('complete');
      expect(surviving.relation).toBe('partial');
      expect(surviving.cleanup).toBe('residual');
    }),
  );

  it.effect('keeps the first decision and records each joiner and destruction as the caller’s own request', () =>
    withStop({
      execution: 'exec-joined',
      endings: [UNMEASURED, ENDED],
      body: Effect.fnUntraced(function* ({ stop, store }) {
        const signalled = yield* stop.stop(keyOf('stop-signal'), 'timeout', 'signal');
        const joined = yield* stop.stop(keyOf('stop-joiner'), 'explicit-stop', 'signal');
        const destroyed = yield* stop.stop(keyOf('stop-destroy'), 'shutdown', 'destroy');
        expect(signalled.cause).toBe('timeout');
        expect(joined.operation).toEqual(signalled.operation);
        expect(joined.confirmed).toEqual([]);
        expect(destroyed.requested).toBe('destroy');
        expect(destroyed.cause).toBe('timeout');
        expect(destroyed.confirmed).toHaveLength(1);
        expect(
          (yield* store.stopRequestsOf(ref('exec-joined').execution)).map(
            (intent) => `${intent.operation.operation}:${intent.requested}:${intent.joined ?? false}`,
          ),
        ).toEqual(['stop-signal:signal:false', 'stop-joiner:signal:true', 'stop-destroy:destroy:false']);
        expect(yield* store.stopOf(ref('exec-joined').execution)).toMatchObject({ operation: keyOf('stop-signal'), cause: 'timeout' });
      }),
    }),
  );

  it.effect('a late observed exit replaces an unverified measurement while preserving the original stop cause', () =>
    Effect.gen(function* () {
      const exit = yield* Ref.make<NativeExit | undefined>(undefined);
      const late: RecordFacts = { ...facts, observedExit: () => Ref.get(exit) };
      yield* withStop({
        execution: 'exec-late',
        endings: [UNMEASURED, ENDED],
        facts: late,
        body: Effect.fnUntraced(function* ({ stop }) {
          expect((yield* stop.stop(keyOf('stop-late-signal'), 'timeout', 'signal')).cleanup).toBe('unverifiable');
          expect((yield* stop.measured)?.cleanup).toBe('unverifiable');
          yield* Ref.set(exit, { _tag: 'Code', code: 0 });
          expect(yield* stop.ended()).toMatchObject({ cleanup: 'complete', relation: 'leader' });
          expect((yield* stop.measured)?.cleanup).toBe('complete');
          expect(yield* stop.stop(keyOf('stop-late-again'), 'explicit-stop', 'signal')).toMatchObject({
            cleanup: 'complete',
            cause: 'timeout',
          });
        }),
      });
    }),
  );

  it.effect('answers later requested actions from a complete unasked measurement without changing its confirmed population', () =>
    withStop({
      execution: 'exec-observed',
      endings: [ENDED],
      facts: { ...facts, observedExit: () => Effect.succeed({ _tag: 'Code', code: 0 }) },
      body: Effect.fnUntraced(function* ({ stop }) {
        const measured = yield* stop.ended();
        expect(measured?.cleanup).toBe('complete');
        const receipt = yield* stop.stop(keyOf('stop-observed'), 'shutdown', 'destroy');
        const again = yield* stop.stop(keyOf('stop-observed-2'), 'explicit-stop', 'destroy');
        expect(receipt).toMatchObject({ requested: 'destroy', cause: 'shutdown', cleanup: 'complete' });
        expect(measured?.confirmed).toEqual(receipt.confirmed);
        expect(again).toMatchObject({ cause: 'shutdown', cleanup: 'complete' });
        expect(yield* stop.ended()).toEqual(measured);
      }),
    }),
  );

  it.effect('prefers a fresh complete measurement over a stale settled receipt', () =>
    withStop({
      execution: 'exec-stale-settled',
      endings: [UNMEASURED, ENDED],
      facts: { ...facts, observedExit: () => Effect.succeed({ _tag: 'Code', code: 0 }) },
      body: Effect.fnUntraced(function* ({ stop }) {
        expect((yield* stop.stop(keyOf('stop-stale-1'), 'explicit-stop', 'signal')).cleanup).not.toBe('complete');
        yield* stop.ended();
        expect(yield* stop.stop(keyOf('stop-stale-2'), 'shutdown', 'destroy')).toMatchObject({ cleanup: 'complete', requested: 'destroy' });
      }),
    }),
  );
});

layer(fixture, { excludeTestServices: true })('a stop receipt after metadata loss', (it) => {
  it.effect('metadata writer death cannot contaminate the complete native cleanup it measured', () =>
    withStop({
      execution: 'exec-lost',
      endings: [ENDED],
      body: Effect.fnUntraced(function* ({ stop }) {
        yield* Effect.promise(() => signalConnection('SIGKILL'));
        const receipt = yield* stop.stop(keyOf('stop-lost'), 'explicit-stop', 'destroy');
        expect(receipt.cleanup).toBe('complete');
        expect(receipt.confirmed).toHaveLength(1);
        expect(receipt.unverifiable.map((row) => row.kind)).toEqual(['record', 'record']);
      }),
    }),
  );
});
