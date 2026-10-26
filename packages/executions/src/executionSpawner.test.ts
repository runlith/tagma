import { EndpointConnection } from './EndpointConnection';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess } from 'effect/process';
import { ExecutionClient } from './ExecutionClient';
import { HostRegistration } from './HostRegistration';
import { HostRefused, WireLost, type ExecutionsFailure } from './Executions';
import { executionSpawner, SpawnAnnotation, type SpawnObservation } from './executionSpawner';
import { ManagedCallFailed } from './ManagedCall';
import { CallCancellation, type CallStopping, type CancellationCause } from './protocol/call';
import { ExecutionId, InstallationId, type ExecutionRef, type ExecutionState } from './protocol/execution';
import { Principal } from './protocol/custody';

const platform = Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})), BunPath.layer);
const services = Layer.merge(
  Layer.succeed(EndpointConnection, EndpointConnection.of({ connect: () => Effect.die('no host belongs to a spawner unit test') })),
  HostRegistration.layer.pipe(Layer.provideMerge(platform)),
);
const limits = { frameBytes: 65536, headerBytes: 16384, connections: 1, requests: 1, subscriptions: 1, credits: 65536 };

const acquiredState = (ref: ExecutionRef): ExecutionState => ({
  ref,
  transport: 'pipes',
  lifetime: 'call',
  purpose: 'internal',
  phase: 'running',
  streams: { stdout: 'open', stderr: 'open', pty: 'open' },
  cleanup: 'pending',
  record: 'available',
});

layer(services)('managed process spawner', (it) => {
  it.effect('a definite refusal survives the spawner; an unsent request is unavailable, not uncertain', () =>
    Effect.gen(function* () {
      const state = '/spawner/refusal';
      const installation = InstallationId.make('refusal');
      const client = yield* ExecutionClient.make({ address: { state, installation }, role: 'custodian', limits });
      const cases: ReadonlyArray<{ failure: ExecutionsFailure; reason: string; detail: string }> = [
        {
          failure: new HostRefused({ refusal: { _tag: 'CapacityExceeded', reason: 'server operation store full' } }),
          reason: 'refused',
          detail: 'CapacityExceeded: server operation store full',
        },
        {
          failure: new WireLost({ sent: false, reason: 'disconnected before dispatch' }),
          reason: 'unavailable',
          detail: 'disconnected before dispatch',
        },
      ];
      for (const entry of cases) {
        const spawner = yield* executionSpawner(
          { materialize: () => Effect.succeed([]) },
          {
            installation,
            purpose: 'internal',
            lifetime: 'call',
            correlation: 'search',
            target: { environment: 'local', namespace: 'local', cwd: state, dependencies: [] },
            holder: Principal.make('reader'),
            origin: Principal.make('reader'),
            readerCredits: 65536,
          },
        ).pipe(Effect.provide(ExecutionClient.context({ ...client, start: () => Effect.fail(entry.failure) })));
        const outcome = yield* Effect.result(spawner.spawn(ChildProcess.make('unused')));
        expect(outcome._tag).toBe('Failure');
        if (outcome._tag === 'Failure') {
          expect(outcome.failure.reason.cause).toBeInstanceOf(ManagedCallFailed);
          expect(outcome.failure.reason.cause).toMatchObject({ reason: entry.reason, detail: entry.detail });
        }
      }
    }),
  );

  it.effect('a lost output record names the execution and stream in its failure', () =>
    Effect.gen(function* () {
      const installation = InstallationId.make('output-refusal');
      const execution: ExecutionRef = { installation, execution: ExecutionId.make('output-1'), incarnation: 1 };
      const client = yield* ExecutionClient.make({
        address: { state: '/tmp/unused-output-refusal', installation },
        role: 'custodian',
        limits,
      });
      const spawner = yield* executionSpawner(
        { materialize: () => Effect.succeed([]) },
        {
          installation,
          purpose: 'internal',
          lifetime: 'call',
          correlation: 'output',
          target: { environment: 'local', namespace: 'local', cwd: '/tmp', dependencies: [] },
          holder: Principal.make('reader'),
          origin: Principal.make('reader'),
          readerCredits: 65536,
        },
      ).pipe(
        Effect.provide(
          ExecutionClient.context({
            ...client,
            start: (operation) =>
              Effect.succeed({
                _tag: 'Started',
                operation,
                execution,
                state: acquiredState(execution),
                native: { pid: 4242 },
              }),
            subscribe: () => Stream.succeed({ _tag: 'Ended', ending: 'gap' }),
            stop: () => Effect.fail(new WireLost({ sent: false, reason: 'this test owns no native child' })),
          }),
        ),
      );
      const handle = yield* spawner.spawn(ChildProcess.make('unused', [], { stdin: 'ignore' }));
      const outcome = yield* Effect.result(Stream.runDrain(handle.stdout));
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') {
        expect(outcome.failure.reason.cause).toEqual({ execution, stream: 'stdout', ending: 'gap' });
      }
    }),
  );

  it.effect('the observer is told once, at acquisition, and only where an execution exists', () =>
    Effect.gen(function* () {
      const state = '/spawner/observed';
      const installation = InstallationId.make('observed');
      const client = yield* ExecutionClient.make({ address: { state, installation }, role: 'custodian', limits });
      const execution: ExecutionRef = {
        installation,
        execution: ExecutionId.make('observed-1'),
        incarnation: 1,
      };
      const seen: Array<SpawnObservation> = [];
      const command = ChildProcess.make('/bin/ripgrep', ['--files'], { stdin: 'ignore' });
      const observed = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        effect.pipe(Effect.provideService(SpawnAnnotation, { observed: (spawn) => seen.push(spawn) }));
      const binding = {
        installation,
        purpose: 'internal' as const,
        lifetime: 'call' as const,
        correlation: 'call-7',
        target: { environment: 'local', namespace: 'local', cwd: state, dependencies: [] },
        holder: Principal.make('reader'),
        origin: Principal.make('reader'),
        readerCredits: 65536,
      };
      const refusing = yield* executionSpawner({ materialize: () => Effect.succeed([]) }, binding).pipe(
        Effect.provide(
          ExecutionClient.context({
            ...client,
            start: () => Effect.fail(new HostRefused({ refusal: { _tag: 'CapacityExceeded', reason: 'server operation store full' } })),
          }),
        ),
      );
      const acquiring = yield* executionSpawner({ materialize: () => Effect.succeed([]) }, binding).pipe(
        Effect.provide(
          ExecutionClient.context({
            ...client,
            start: (operation) =>
              Effect.succeed({
                _tag: 'Started',
                operation,
                execution,
                state: acquiredState(execution),
                native: { pid: 4242 },
              }),
          }),
        ),
      );

      const refused = yield* Effect.result(observed(refusing.spawn(command)));
      expect(refused._tag).toBe('Failure');
      expect(seen).toEqual([]);

      yield* observed(acquiring.spawn(command));
      expect(seen).toHaveLength(1);
      expect(seen[0]?.execution).toEqual(execution);
      expect(seen[0]?.operation.installation).toEqual(installation);
      expect(seen[0]?.operation.operation.startsWith('call-7:')).toBe(true);
      expect(seen[0]?.command).toEqual({ program: '/bin/ripgrep', args: ['--files'], environment: [] });
    }),
  );

  it.effect('an ending preserves a declared cancellation cause and records an untouched scope as closed', () =>
    Effect.gen(function* () {
      const state = '/spawner/cause';
      const installation = InstallationId.make('causes');
      const client = yield* ExecutionClient.make({ address: { state, installation }, role: 'custodian', limits });
      const execution: ExecutionRef = {
        installation,
        execution: ExecutionId.make('caused-1'),
        incarnation: 1,
      };
      const command = ChildProcess.make('/bin/ripgrep', ['--files'], { stdin: 'ignore' });
      const binding = {
        installation,
        purpose: 'internal' as const,
        lifetime: 'call' as const,
        correlation: 'call-8',
        target: { environment: 'local', namespace: 'local', cwd: state, dependencies: [] },
        holder: Principal.make('reader'),
        origin: Principal.make('reader'),
        readerCredits: 65536,
      };
      const spawnerFor = (cell: Deferred.Deferred<CancellationCause>, stop?: CallStopping) =>
        executionSpawner({ materialize: () => Effect.succeed([]) }, { ...binding, stop }).pipe(
          Effect.provide(
            ExecutionClient.context({
              ...client,
              start: (operation) =>
                Effect.succeed({
                  _tag: 'Started',
                  operation,
                  execution,
                  state: acquiredState(execution),
                  native: { pid: 4242 },
                }),
              stop: (_operation, _execution, cause) =>
                Effect.andThen(
                  Deferred.succeed(cell, cause),
                  Effect.fail(new WireLost({ sent: true, reason: 'this case performs no stop' })),
                ),
            }),
          ),
        );

      const declared = yield* Effect.scoped(
        Effect.gen(function* () {
          const cell = yield* Deferred.make<CancellationCause>();
          const stopping = yield* Deferred.make<CallCancellation>();
          let said: CallCancellation | null = null;
          const spawner = yield* spawnerFor(cell, { stopped: () => said, stopping: Deferred.await(stopping) });
          yield* spawner.spawn(command);
          said = new CallCancellation('timeout', 'the call ran out of its own time');
          yield* Deferred.succeed(stopping, said);
          return yield* Deferred.await(cell);
        }),
      );

      const aborted = yield* Effect.scoped(
        Effect.gen(function* () {
          const cell = yield* Deferred.make<CancellationCause>();
          const stopping = yield* Deferred.make<CallCancellation>();
          let said: CallCancellation | null = null;
          const spawner = yield* spawnerFor(cell, { stopped: () => said, stopping: Deferred.await(stopping) });
          yield* spawner.spawn(command);
          said = new CallCancellation('run-abort', 'the run stopped');
          yield* Deferred.succeed(stopping, said);
          return yield* Deferred.await(cell);
        }),
      );

      const cell = yield* Deferred.make<CancellationCause>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* spawnerFor(cell);
          yield* spawner.spawn(command);
        }),
      );
      const closed = yield* Deferred.await(cell);
      expect(declared).toBe('timeout');
      expect(aborted).toBe('run-abort');
      expect(closed).toBe('scope-closed');
    }),
  );
});
