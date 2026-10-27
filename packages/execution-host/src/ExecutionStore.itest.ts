import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Database } from 'bun:sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Clock, Data, Effect, Layer, Result, Schema, Schedule } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { FileSystem } from 'effect';
import { fileURLToPath } from 'node:url';
import { CommandAdmission, originOf } from '@runlith/executions/protocol/command';
import type { CallDecision } from '@runlith/executions/protocol/call';
import { ConnectionId } from '@runlith/executions/protocol/registration';
import {
  InstallationId,
  ExecutionId,
  HostRequestKey,
  type ExecutionRef,
  type ExecutionState,
} from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { FinalFacts } from '@runlith/executions/protocol/stop';
import type { Holder } from './holder/Holder';
import { ExecutionCapacity } from './ExecutionCapacity';
import { HostAdmission } from './HostAdmission';
import { executionStore, ExecutionStore } from './store/ExecutionStore';
import type { LaunchRequest, OperationEntry } from './store/records';
import { INSTALLATION, fixtureHolder, hostProfile, registrationOf, signalConnection } from './hostFixture';
import { hostState } from './hostState';
import { OperationReceipt, StopIntent } from './db/persisted';

const installation = InstallationId.make(INSTALLATION);
const profile = hostProfile({ executions: 2 });
const ref = (execution: string, incarnation = 0): ExecutionRef => ({ installation, execution: ExecutionId.make(execution), incarnation });
const key = (operation: string) => ({ installation, operation: HostRequestKey.make(operation) });
type LaunchInput = { readonly execution: string; readonly key: string; readonly fingerprint?: string; readonly incarnation?: number };
const launch = ({ execution, key: operation, fingerprint = 'command:echo one', incarnation = 0 }: LaunchInput): LaunchRequest => {
  const identity = ref(execution, incarnation);
  return {
    operation: key(operation),
    fingerprint,
    ref: identity,
    transport: 'pipes',
    lifetime: 'call',
    purpose: 'command',
    target: { environment: 'local', namespace: 'default', cwd: '/tmp', dependencies: ['receipt-a', 'receipt-b'] },
    holder: Principal.make('agent-1'),
    origin: Principal.make('agent-1'),
    receipt: { _tag: 'Accepted', execution: identity },
  };
};
const running = (execution: string, incarnation = 0): ExecutionState => ({
  ref: ref(execution, incarnation),
  transport: 'pipes',
  lifetime: 'call',
  purpose: 'command',
  phase: 'running',
  streams: { stdout: 'open', stderr: 'open', pty: 'open' },
  cleanup: 'pending',
  record: 'available',
});
const ended = (execution: string, incarnation = 0): ExecutionState => ({
  ...running(execution, incarnation),
  phase: 'ended',
  nativeExit: { _tag: 'Code', code: 0 },
  streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
  cleanup: 'complete',
});
type StoreInput = {
  readonly directory: string;
  readonly processes: ProcessPool;
  readonly bound?: number;
  readonly holder?: Layer.Layer<Holder>;
};
const over = ({ directory, processes, bound, holder }: StoreInput) =>
  executionStore(`${directory}/executions.sqlite`, registrationOf(directory), processes).pipe(
    Layer.provide(holder ?? fixtureHolder(bound)),
    Layer.provideMerge(ExecutionCapacity.layer(profile)),
  );
const killable = () => new ProcessPool(undefined, 'stop', undefined, childHosting);
const hostOver = (directory: string, processes: ProcessPool) =>
  hostState(`${directory}/executions.sqlite`, registrationOf(directory), processes).pipe(
    Layer.provide(fixtureHolder()),
    Layer.provideMerge(ExecutionCapacity.layer(profile)),
  );
const temporary = Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'execution-store-' }));
type StoreCase<A, E, R> = {
  readonly work: Effect.Effect<A, E, R>;
  readonly directory?: string;
  readonly bound?: number;
  readonly holder?: Layer.Layer<Holder>;
  readonly processes?: ProcessPool;
};
const withStore = Effect.fnUntraced(function* <A, E, R>({ work, directory: selected, bound, holder, processes }: StoreCase<A, E, R>) {
  const directory = selected ?? (yield* temporary);
  const pool = processes ?? (yield* sharedPool);
  return yield* Effect.scoped(work.pipe(Effect.provide(Layer.fresh(over({ directory, processes: pool, bound, holder })))));
});
const killConnection = () => Effect.promise(() => signalConnection('SIGKILL'));
class FixtureSqlFailed extends Data.TaggedError('FixtureSqlFailed')<{ readonly message: string }> {}
const sqlFailed = (error: unknown) => new FixtureSqlFailed({ message: String(error) });
type DatabaseInput<A> = { readonly path: string; readonly use: (database: Database) => A };
const withDatabase = <A>({ path, use }: DatabaseInput<A>) =>
  Effect.acquireUseRelease(
    Effect.try({ try: () => new Database(path), catch: sqlFailed }),
    (database) => Effect.try({ try: () => use(database), catch: sqlFailed }),
    (database) => Effect.sync(() => database.close()),
  );
const chain = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
const before = (suffix: string) => {
  const index = chain.findIndex((migration) => migration.name?.endsWith(suffix) ?? false);
  if (index < 1) throw new Error(`the migration ${suffix} has no installed predecessor`);
  return { earlier: chain.slice(0, index), migration: chain[index]! };
};
type InstalledInput<A> = { readonly path: string; readonly suffix: string; readonly at: number; readonly use: (database: Database) => A };
const installed = <A>({ path, suffix, at, use }: InstalledInput<A>) =>
  withDatabase({
    path,
    use: (database) => {
      const { earlier } = before(suffix);
      for (const migration of earlier) for (const statement of migration.sql) database.run(statement);
      database.run(
        'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)',
      );
      for (const migration of earlier)
        database.run('INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)', [
          migration.hash,
          migration.folderMillis,
          migration.name,
          new Date(at).toISOString(),
        ]);
      return use(database);
    },
  });

const reserve = Effect.fnUntraced(function* (request: LaunchRequest) {
  yield* (yield* ExecutionCapacity).reserve(request.ref.execution, 'pipes');
  return yield* (yield* ExecutionStore).reserve(request);
});

describe('operation keys', () => {
  it.live('a refused reserved launch keeps its refusal and ended state after the same generation reopens', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const request = launch({ execution: 'exec-refused', key: 'start-refused' });
      const refusal = { _tag: 'SpawnFailed', reason: 'the executable cannot be opened' } as const;
      yield* withStore({
        directory,
        bound: 0,
        work: Effect.gen(function* () {
          yield* reserve(request);
          yield* (yield* ExecutionStore).refuseStart(request.operation, request.ref, refusal);
        }),
      });
      yield* withStore({
        directory,
        bound: 0,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          expect((yield* store.operationAnswerOf(request.operation))?.receipt).toEqual({ _tag: 'Refused', refusal });
          const saved = yield* store.executionOf(request.ref.execution);
          expect(saved.state.phase).toBe('ended');
          expect(saved.native.pid).toBeUndefined();
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a repeated key returns its first receipt and a changed fingerprint conflicts without inserting a second execution', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const capacity = yield* ExecutionCapacity;
        yield* capacity.reserve(ref('exec-1').execution, 'pipes');
        yield* capacity.reserve(ref('exec-2').execution, 'pipes');
        expect((yield* store.reserve(launch({ execution: 'exec-1', key: 'start-1' })))._tag).toBe('Recorded');
        const repeated = yield* store.reserve(launch({ execution: 'exec-2', key: 'start-1' }));
        expect(repeated._tag).toBe('Taken');
        expect(repeated.entry.receipt).toEqual({ _tag: 'Accepted', execution: ref('exec-1') });
        expect(
          (yield* Effect.flip(store.reserve(launch({ execution: 'exec-2', key: 'start-1', fingerprint: 'command:echo two' }))))._tag,
        ).toBe('OperationConflict');
        expect((yield* Effect.flip(store.executionOf(ref('exec-2').execution)))._tag).toBe('StoredExecutionMissing');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a pre-start cancellation tombstone prevents later admission under its key', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        yield* (yield* ExecutionCapacity).reserve(ref('exec-cancelled').execution, 'pipes');
        const tombstone: OperationEntry = {
          operation: key('start-cancelled'),
          kind: 'tombstone',
          fingerprint: 'command:echo one',
          receipt: { _tag: 'Refused', refusal: { _tag: 'AdmissionClosed', reason: 'the caller cancelled before the start' } },
        };
        yield* store.settle(tombstone);
        expect(yield* store.reserve(launch({ execution: 'exec-cancelled', key: 'start-cancelled' }))).toMatchObject({
          _tag: 'Taken',
          entry: { kind: 'tombstone' },
        });
        expect((yield* store.operationOf(tombstone.operation))?.kind).toBe('tombstone');
        expect((yield* Effect.flip(store.executionOf(ref('exec-cancelled').execution)))._tag).toBe('StoredExecutionMissing');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

describe('custody and atomic units', () => {
  it.live('refuses stale execution custody without changing the committed holder', () =>
    withStore({
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const store = yield* ExecutionStore;
        yield* store.updateCustody(ref('exec-1'), 0, { holder: Principal.make('agent-2') });
        expect((yield* Effect.flip(store.updateCustody(ref('exec-1'), 0, { holder: Principal.make('agent-3') })))._tag).toBe(
          'RevisionConflict',
        );
        expect(yield* store.custodyOf(ref('exec-1').execution)).toMatchObject({ revision: 1, holder: 'agent-2' });
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('exactly one concurrent execution custody move commits over the same revision', () =>
    withStore({
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const store = yield* ExecutionStore;
        const results = yield* Effect.forEach(
          ['agent-2', 'agent-3'],
          (holder) => Effect.result(store.updateCustody(ref('exec-1'), 0, { holder: Principal.make(holder) })),
          { concurrency: 2 },
        );
        expect(results.filter(Result.isSuccess)).toHaveLength(1);
        expect(results.filter(Result.isFailure).map((result) => result.failure._tag)).toEqual(['RevisionConflict']);
        const standing = yield* store.custodyOf(ref('exec-1').execution);
        expect(standing.revision).toBe(1);
        expect(['agent-2', 'agent-3']).toContain(standing.holder);
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('host custody replays one transition, rejects changed and stale requests, and returns its write charge', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const take = { _tag: 'Take', operation: key('take-1'), expected: 0, connection: ConnectionId.make('server-1') } as const;
        expect(yield* store.acceptCustody(take)).toMatchObject({
          _tag: 'Accepted',
          standing: { epoch: 1, revision: 1, holder: { connection: 'server-1', incarnation: 0 } },
        });
        expect(yield* store.acceptCustody(take)).toMatchObject({ _tag: 'Standing', answered: { epoch: 1 } });
        expect((yield* Effect.flip(store.acceptCustody({ ...take, connection: ConnectionId.make('server-2') })))._tag).toBe(
          'OperationConflict',
        );
        expect(
          (yield* Effect.flip(store.acceptCustody({ ...take, operation: key('take-stale'), connection: ConnectionId.make('server-3') })))
            ._tag,
        ).toBe('CustodyConflict');
        expect(yield* store.hostCustody()).toMatchObject({ epoch: 1, revision: 1 });
        expect((yield* (yield* ExecutionCapacity).account()).custodyReceipts).toBe(0);
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('refuses exhausted epochs and rejects out-of-range or half-written custody rows', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          expect((yield* (yield* ExecutionStore).hostCustody()).epoch).toBe(0);
        }),
      });
      yield* withDatabase({ path, use: (db) => db.run(`UPDATE host_custody SET epoch = ${Number.MAX_SAFE_INTEGER}`) });
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          expect(
            (yield* Effect.flip(
              store.acceptCustody({
                _tag: 'Take',
                operation: key('take-at-ceiling'),
                expected: 0,
                connection: ConnectionId.make('server-1'),
              }),
            ))._tag,
          ).toBe('CustodyRefused');
          expect(yield* store.hostCustody()).toMatchObject({ epoch: Number.MAX_SAFE_INTEGER, revision: 0 });
        }),
      });
      yield* withDatabase({ path, use: (db) => db.run('UPDATE host_custody SET epoch = 9007199254740993') });
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          expect((yield* Effect.flip((yield* ExecutionStore).hostCustody()))._tag).toBe('StoreUnreadable');
        }),
      });
      yield* withDatabase({
        path,
        use: (db) => db.run("UPDATE host_custody SET epoch = 1, holder_connection = 'server-1', holder_incarnation = NULL"),
      });
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          expect((yield* Effect.flip((yield* ExecutionStore).hostCustody()))._tag).toBe('StoreUnreadable');
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('returns the charge when a release loses its custody write condition', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const first = yield* store.acceptCustody({
          _tag: 'Take',
          operation: key('take-1'),
          expected: 0,
          connection: ConnectionId.make('server-1'),
        });
        const second = yield* store.acceptCustody({
          _tag: 'Take',
          operation: key('take-2'),
          expected: first.standing.revision,
          connection: ConnectionId.make('server-2'),
        });
        expect(
          (yield* Effect.flip(
            store.acceptCustody({
              _tag: 'Release',
              operation: key('release-1'),
              expected: second.standing.revision,
              epoch: first.standing.epoch,
              holder: { connection: ConnectionId.make('server-1'), incarnation: 0 },
            }),
          ))._tag,
        ).toBe('CustodyConflict');
        expect((yield* (yield* ExecutionCapacity).account()).custodyReceipts).toBe(0);
        expect(yield* store.hostCustody()).toMatchObject({ epoch: 2, revision: 2 });
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('exactly one host custody transition commits over the same revision', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const results = yield* Effect.forEach(
          ['a', 'b'],
          (name) =>
            Effect.result(
              store.acceptCustody({
                _tag: 'Take',
                operation: key(`take-${name}`),
                expected: 0,
                connection: ConnectionId.make(`server-${name}`),
              }),
            ),
          { concurrency: 2 },
        );
        expect(results.filter(Result.isSuccess)).toHaveLength(1);
        expect(results.filter(Result.isFailure).map((result) => result.failure._tag)).toEqual(['CustodyConflict']);
        const standing = yield* store.hostCustody();
        expect(standing).toMatchObject({ epoch: 1, revision: 1 });
        expect(['server-a', 'server-b']).toContain(String(standing.holder?.connection));
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('commits concurrent multi-statement admissions whole', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const capacity = yield* ExecutionCapacity;
        for (const name of ['exec-1', 'exec-2']) yield* capacity.reserve(ref(name).execution, 'pipes');
        const results = yield* Effect.all(
          [
            store.reserve(launch({ execution: 'exec-1', key: 'start-1' })),
            store.reserve(launch({ execution: 'exec-2', key: 'start-2', fingerprint: 'command:echo two' })),
          ],
          { concurrency: 2 },
        );
        expect(results.map((result) => result._tag)).toEqual(['Recorded', 'Recorded']);
        expect((yield* store.executionOf(ref('exec-1').execution)).target.dependencies).toEqual(['receipt-a', 'receipt-b']);
        expect(yield* store.executionOf(ref('exec-2').execution)).toMatchObject({
          state: { phase: 'reserved' },
          target: { dependencies: ['receipt-a', 'receipt-b'] },
        });
        expect(yield* store.custodyOf(ref('exec-2').execution)).toMatchObject({
          revision: 0,
          target: { dependencies: ['receipt-a', 'receipt-b'] },
        });
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a rolled-back custody unit does not damage a concurrent successful admission', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const capacity = yield* ExecutionCapacity;
        for (const name of ['exec-1', 'exec-2']) yield* capacity.reserve(ref(name).execution, 'pipes');
        yield* store.reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        yield* store.updateCustody(ref('exec-1'), 0, { holder: Principal.make('agent-2') });
        const [refused] = yield* Effect.all(
          [
            Effect.flip(store.updateCustody(ref('exec-1'), 0, { holder: Principal.make('agent-3') })),
            store.reserve(launch({ execution: 'exec-2', key: 'start-2', fingerprint: 'command:echo two' })),
          ],
          { concurrency: 2 },
        );
        expect(refused._tag).toBe('RevisionConflict');
        expect((yield* store.executionOf(ref('exec-2').execution)).state.phase).toBe('reserved');
        expect(yield* store.custodyOf(ref('exec-1').execution)).toMatchObject({ revision: 1, holder: 'agent-2' });
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

describe('call records and departures', () => {
  it.live('keeps the first call decision over a later contradictory decision', () =>
    withStore({
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const store = yield* ExecutionStore;
        yield* store.recordCall({
          operation: key('start-1'),
          execution: ref('exec-1'),
          budget: { timeoutMs: 5_000 },
          started: 'native-acquired',
        });
        const completed: CallDecision = { _tag: 'Completed', operation: key('start-1'), execution: ref('exec-1'), sequence: 0 };
        expect(yield* store.decide(completed)).toMatchObject({ _tag: 'Recorded', decision: { _tag: 'Completed' } });
        expect(
          yield* store.decide({
            _tag: 'Cancelled',
            operation: key('start-1'),
            execution: ref('exec-1'),
            sequence: 1,
            cause: 'timeout',
            trigger: 'deadline',
          }),
        ).toMatchObject({ _tag: 'Standing', decision: { _tag: 'Completed' } });
        expect(yield* store.callOf(key('start-1'))).toMatchObject({ started: 'native-acquired', budget: { timeoutMs: 5_000 } });
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('reads final evidence separately from the running row it recorded', () =>
    withStore({
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const store = yield* ExecutionStore;
        yield* store.recordStop({ operation: key('stop-1'), execution: ref('exec-1'), cause: 'explicit-stop', coverage: ['leader'] });
        yield* store.recordState(running('exec-1'), { pid: 4242, terminal: '/dev/ttys004' });
        const facts: FinalFacts = {
          execution: ref('exec-1'),
          nativeExit: { _tag: 'Signal', signal: 'SIGTERM' },
          sources: { stdout: { completed: true, offset: byteOffset(128n) }, stderr: { completed: false, offset: byteOffset(0n) } },
          cleanup: 'residual',
          retention: 'partial',
          confirmed: [{ pid: 4242, relation: 'leader', exit: { _tag: 'Signal', signal: 'SIGTERM' } }],
          residual: [{ kind: 'process', detail: 'surviving descendant', pid: 4243 }],
          unverifiable: [],
          streams: [
            { stream: 'stdout', ending: 'eof' },
            { stream: 'stderr', ending: 'open' },
          ],
          relation: 'partial',
          coverage: ['leader'],
          abandonedOutput: false,
        };
        yield* store.recordFinal(facts);
        expect(yield* store.stopOf(ref('exec-1').execution)).toMatchObject({ cause: 'explicit-stop', coverage: ['leader'] });
        expect(yield* store.finalOf(ref('exec-1').execution)).toMatchObject({
          nativeExit: facts.nativeExit,
          sources: facts.sources,
          cleanup: 'residual',
        });
        const record = yield* store.executionOf(ref('exec-1').execution);
        expect(record.state.phase).toBe('running');
        expect(record.native).toEqual({ pid: 4242, terminal: '/dev/ttys004' });
        expect(record.state.nativeExit).toBeUndefined();
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('never reopens a generation phase after it began stopping', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        expect((yield* store.incarnation()).phase).toBe('open');
        yield* store.enterPhase('stopping');
        expect((yield* store.incarnation()).phase).toBe('stopping');
        expect(yield* store.enterPhase('open')).toBe('stopping');
        expect((yield* store.incarnation()).phase).toBe('stopping');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('keeps a departure readable until dropped and retains a loss as a refusal', () =>
    withStore({
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const departure = {
          input: { accepted: byteOffset(7n), remainder: new TextEncoder().encode('tail'), ended: true },
          parsed: byteOffset(42n),
          descendants: [],
          echoes: [{ after: 3, bytes: Uint8Array.of(94, 67) }],
        };
        expect((yield* Effect.result(store.recordDeparture({ execution: ref('exec-9'), departure })))._tag).toBe('Failure');
        yield* store.recordDeparture({ execution: ref('exec-1'), departure });
        yield* reserve(launch({ execution: 'exec-2', key: 'start-2' }));
        yield* store.recordLoss(ref('exec-2').execution, 'the writer did not stop');
        const carried = yield* store.departureOf(ref('exec-1').execution);
        expect(carried).toMatchObject({
          input: { accepted: byteOffset(7n), ended: true },
          parsed: byteOffset(42n),
          echoes: departure.echoes,
        });
        expect(new TextDecoder().decode(carried?.input?.remainder)).toBe('tail');
        expect(yield* store.departureOf(ref('exec-1').execution)).toEqual(carried);
        yield* store.dropDeparture(ref('exec-1').execution);
        expect(yield* store.departureOf(ref('exec-1').execution)).toBeUndefined();
        expect(yield* Effect.flip(store.departureOf(ref('exec-2').execution))).toMatchObject({
          _tag: 'DepartureLost',
          detail: 'the writer did not stop',
        });
        expect((yield* Effect.flip(store.departureOf(ref('exec-2').execution)))._tag).toBe('DepartureLost');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

describe('generations', () => {
  it.live('a bound holder continues its generation after a store reopen without retiring its identities or keys', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const holding = yield* Layer.build(fixtureHolder());
      const holder = Layer.succeedContext(holding);
      const first = yield* withStore({
        directory,
        holder,
        work: Effect.gen(function* () {
          yield* reserve(launch({ execution: 'continued', key: 'continued-key' }));
          return (yield* (yield* ExecutionStore).incarnation()).incarnation;
        }),
      });
      yield* withStore({
        directory,
        holder,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          yield* store.recordState(running('continued', first), {});
          expect((yield* store.incarnation()).incarnation).toBe(first);
          expect((yield* store.executionOf(ref('continued').execution)).state.ref).toEqual(ref('continued', first));
          expect((yield* store.operationAnswerOf(key('continued-key')))?.receipt).toEqual({
            _tag: 'Accepted',
            execution: ref('continued', first),
          });
          expect(yield* store.retiredGenerations()).toEqual([]);
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a replacement generation retires its prior records without permitting a spent start key', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const entered = yield* withStore({
        directory,
        work: Effect.gen(function* () {
          yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
          return (yield* (yield* ExecutionStore).incarnation()).incarnation;
        }),
      });
      expect(entered).toBe(0);
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          yield* (yield* ExecutionCapacity).reserve(ref('exec-2').execution, 'pipes');
          expect((yield* store.incarnation()).incarnation).toBe(1);
          expect((yield* Effect.flip(store.executionOf(ref('exec-1').execution)))._tag).toBe('StoredExecutionMissing');
          expect((yield* Effect.flip(store.recordState(running('exec-1', entered), {})))._tag).toBe('StoredExecutionMissing');
          expect((yield* Effect.flip(store.reserve(launch({ execution: 'exec-2', key: 'start-1', incarnation: entered + 1 }))))._tag).toBe(
            'OperationConflict',
          );
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

describe('installed metadata', () => {
  it.live('a store at the ledger Tagma 0.1.0 shipped opens at the head of the chain and keeps its executions', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      const at = yield* Clock.currentTimeMillis;
      const next = chain[chain.findIndex((migration) => migration.name === '20261024112808_pace_lowered') + 1]?.name;
      if (next == null) return yield* Effect.die(new Error('no migration follows the ledger 0.1.0 shipped'));
      yield* installed({
        path,
        suffix: next,
        at,
        use: (db) => {
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (0, ?, ?, ?, 1, ?)',
            [INSTALLATION, JSON.stringify(registrationOf(directory)), 'open', at],
          );
          db.run(
            `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, native_exit, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, pid, terminal, created_at, updated_at) VALUES ('exec-issued', ?, 0, 'pty', 'held', 'command', 'ended', ?, 'eof', 'eof', 'eof', 'complete', 'available', 'local', 'default', '/tmp', 4242, '/dev/ttys004', ?, ?)`,
            [INSTALLATION, JSON.stringify({ _tag: 'Code', code: 0 }), at, at],
          );
        },
      });
      const saved = yield* withStore({
        directory,
        work: Effect.flatMap(ExecutionStore, (store) => store.evidenceOf(ref('exec-issued'))),
      });
      const ledger = yield* withDatabase({
        path,
        use: (db) => db.query<{ n: number }, []>('SELECT count(*) AS n FROM __drizzle_migrations').get()?.n,
      });
      expect([saved.record.state.phase, saved.record.native, ledger]).toEqual([
        'ended',
        { pid: 4242, terminal: '/dev/ttys004' },
        chain.length,
      ]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('upgrades action words without rewriting exit signals, native identities or diagnostic text', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      const at = yield* Clock.currentTimeMillis;
      const coverage = ['leader', 'process-group', 'same-tty', 'ancestry'];
      const signals = ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGKILL'];
      const confirmed = [
        ...signals.map((signal, index) => ({
          pid: 4242 + index,
          relation: coverage[index],
          exit: { _tag: 'Signal', signal },
          step: signal,
        })),
        { pid: 4246, relation: 'process-group', exit: { _tag: 'Code', code: 0 } },
      ];
      const residual = [
        { kind: 'process', pid: 4300, relation: 'process-group', detail: 'SIGINT' },
        { kind: 'process', pid: 4400, relation: 'same-tty', detail: 'process-group' },
      ];
      yield* installed({
        path,
        suffix: '_execution_actions',
        at,
        use: (db) => {
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (0, ?, ?, ?, 1, ?)',
            [INSTALLATION, JSON.stringify(registrationOf(directory)), 'open', at],
          );
          db.run(
            `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, native_exit, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, pid, tty, created_at, updated_at) VALUES ('exec-actions', ?, 0, 'pty', 'held', 'command', 'ended', ?, 'eof', 'eof', 'eof', 'residual', 'available', 'local', 'default', '/tmp', 4242, '/dev/ttys004', ?, ?)`,
            [INSTALLATION, JSON.stringify({ _tag: 'Signal', signal: 'SIGTERM' }), at, at],
          );
          db.run(
            `INSERT INTO stop_intent (execution_id, installation, operation_id, incarnation, cause, coverage, requested, joined, requested_at) VALUES ('exec-actions', ?, 'stop-actions', 0, 'explicit-stop', ?, 'signal', 0, ?)`,
            [INSTALLATION, JSON.stringify(coverage), at],
          );
          db.run(
            `INSERT INTO final_facts (execution_id, installation, incarnation, native_exit, sources, cleanup, retention, confirmed, residual, unverifiable, streams, relation, coverage, abandoned_output, recorded_at) VALUES ('exec-actions', ?, 0, ?, ?, 'residual', 'retained', ?, ?, '[]', '[]', 'partial', ?, 0, ?)`,
            [
              INSTALLATION,
              JSON.stringify({ _tag: 'Signal', signal: 'SIGTERM' }),
              JSON.stringify({ stdout: { completed: true, offset: '0' }, stderr: { completed: true, offset: '0' } }),
              JSON.stringify(confirmed),
              JSON.stringify(residual),
              JSON.stringify(coverage),
              at,
            ],
          );
        },
      });
      const record = yield* withStore({
        directory,
        work: Effect.flatMap(ExecutionStore, (store) => store.evidenceOf(ref('exec-actions'))),
      });
      const intent = yield* withDatabase({
        path,
        use: (db) => db.query<{ coverage: string }, []>("SELECT coverage FROM stop_intent WHERE operation_id = 'stop-actions'").get(),
      });
      const stop = yield* Schema.decodeUnknownEffect(StopIntent)({
        operation: key('stop-actions'),
        execution: ref('exec-actions'),
        cause: 'explicit-stop',
        coverage: JSON.parse(intent?.coverage ?? 'null'),
      });
      expect(record.record.native).toEqual({ pid: 4242, terminal: '/dev/ttys004' });
      expect(record.record.state.nativeExit).toEqual({ _tag: 'Signal', signal: 'SIGTERM' });
      expect(record.final?.nativeExit).toEqual({ _tag: 'Signal', signal: 'SIGTERM' });
      expect(record.final?.confirmed.map((ending) => ending.step)).toEqual(['hang-up', 'interrupt', 'terminate', 'kill', undefined]);
      expect(record.final?.confirmed.map((ending) => ending.exit)).toEqual([
        ...signals.map((signal) => ({ _tag: 'Signal' as const, signal })),
        { _tag: 'Code', code: 0 },
      ]);
      expect(record.final?.coverage).toEqual(['leader', 'work', 'terminal', 'ancestry']);
      expect(stop.coverage).toEqual(['leader', 'work', 'terminal', 'ancestry']);
      expect(record.final?.residual).toEqual([
        { kind: 'process', pid: 4300, relation: 'work', detail: 'SIGINT' },
        { kind: 'process', pid: 4400, relation: 'terminal', detail: 'process-group' },
      ]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('carries installed custody epochs forward rather than issuing them again', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      const at = yield* Clock.currentTimeMillis;
      const first = chain[0];
      if (first === undefined) return yield* Effect.die(new Error('the migration chain is empty'));
      yield* withDatabase({
        path,
        use: (db) => {
          for (const statement of first.sql) db.run(statement);
          db.run(
            'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)',
          );
          db.run('INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)', [
            first.hash,
            first.folderMillis,
            first.name,
            new Date(at).toISOString(),
          ]);
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, epoch, current, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [0, INSTALLATION, JSON.stringify(registrationOf(directory)), 'open', 7, 1, at],
          );
        },
      });
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          const carried = yield* store.hostCustody();
          expect(carried).toMatchObject({ epoch: 7, revision: 0 });
          expect(carried.holder).toBeUndefined();
          expect(
            (yield* store.acceptCustody({
              _tag: 'Take',
              operation: key('take-after-upgrade'),
              expected: carried.revision,
              connection: ConnectionId.make('server-after-upgrade'),
            })).standing.epoch,
          ).toBe(8);
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('upgrades an installed stop policy and permits the next stop without that policy', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      const at = yield* Clock.currentTimeMillis;
      yield* installed({
        path,
        suffix: '_stop_ladder',
        at,
        use: (db) => {
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (?, ?, ?, ?, ?, ?)',
            [0, INSTALLATION, JSON.stringify(registrationOf(directory)), 'open', 1, at],
          );
          db.run(
            `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, created_at, updated_at) VALUES ('exec-old', ?, 0, 'pipes', 'call', 'command', 'running', 'open', 'open', 'eof', 'pending', 'available', 'local', 'default', '/tmp', ?, ?)`,
            [INSTALLATION, at, at],
          );
          db.run(
            `INSERT INTO stop_intent (execution_id, installation, operation_id, incarnation, cause, policy, coverage, requested, joined, requested_at) VALUES ('exec-old', ?, 'stop-old', 0, 'explicit-stop', ?, '["leader"]', 'signal', 0, ?)`,
            [INSTALLATION, JSON.stringify({ signal: 'SIGTERM', forceAfterMs: 3_000 }), at],
          );
          db.run(
            `INSERT INTO call (installation, operation_id, execution_id, budget, created_at, updated_at) VALUES (?, 'start-old', 'exec-old', ?, ?, ?)`,
            [INSTALLATION, JSON.stringify({ timeoutMs: 5_000, stop: { signal: 'SIGTERM', forceAfterMs: 3_000 } }), at, at],
          );
        },
      });
      yield* withStore({
        directory,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          expect((yield* store.operationOf(key('stop-old')))?.receipt._tag).toBe('Refused');
          yield* reserve(launch({ execution: 'exec-new', key: 'start-new', incarnation: 1 }));
          yield* store.recordStop({
            operation: key('stop-new'),
            execution: ref('exec-new', 1),
            cause: 'explicit-stop',
            coverage: ['leader'],
          });
          expect(yield* store.stopOf(ref('exec-new', 1).execution)).toMatchObject({ cause: 'explicit-stop', operation: key('stop-new') });
        }),
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('an installed call budget retains its timeout after the stop policy is removed', () =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const kept = yield* withDatabase({
        path: ':memory:',
        use: (db) => {
          const { earlier, migration } = before('_stop_ladder');
          for (const item of earlier) for (const statement of item.sql) db.run(statement);
          db.run(
            `INSERT INTO call (installation, operation_id, execution_id, budget, created_at, updated_at) VALUES (?, 'start-old', 'exec-old', ?, ?, ?)`,
            [INSTALLATION, JSON.stringify({ timeoutMs: 5_000, stop: { signal: 'SIGTERM', forceAfterMs: 3_000 } }), at, at],
          );
          for (const statement of migration.sql) db.run(statement);
          return db.query<{ budget: string }, []>("SELECT budget FROM call WHERE operation_id = 'start-old'").get();
        },
      });
      expect(yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ timeoutMs: Schema.Number })))(kept?.budget)).toEqual({
        timeoutMs: 5_000,
      });
    }),
  );

  it.live('an installed admission keeps its limits and revision ceiling while removing workload fields', () =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const origin = { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' };
      const saved = yield* withDatabase({
        path: ':memory:',
        use: (db) => {
          const { earlier, migration } = before('_command_time_without_ceiling');
          for (const item of earlier) for (const statement of item.sql) db.run(statement);
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (?, ?, ?, ?, ?, ?)',
            [0, INSTALLATION, '{}', 'open', 1, at],
          );
          db.run(
            `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, command, created_at, updated_at) VALUES ('exec-old', ?, 0, 'pipes', 'command', 'command', 'running', 'open', 'open', 'eof', 'pending', 'available', 'local', 'default', '/tmp', ?, ?, ?)`,
            [
              INSTALLATION,
              JSON.stringify({
                origin,
                limits: { executionMs: 60_000, executionCeilingMs: 600_000, queueMs: 5_000 },
                workload: { slots: 1, priority: 0, maxQueued: 8 },
                policyIdentity: 'policy-1',
                enclosing: 'enclosing/old',
              }),
              at,
              at,
            ],
          );
          db.run(
            `INSERT INTO command_revision (execution_id, installation, incarnation, revision, operation_id, fingerprint, execution_ms, ceiling_ms, actor, cause, outcome, accepted_at) VALUES ('exec-old', ?, 0, 1, 'revise-old', 'revise/1', 30000, 600000, 'agent-1', 'shorter', 'applied', ?)`,
            [INSTALLATION, at],
          );
          for (const statement of migration.sql) db.run(statement);
          const admitted = db.query<{ command: string }, []>("SELECT command FROM execution WHERE execution_id = 'exec-old'").get();
          const revised = db
            .query<{ execution_ms: number; ceiling_ms: number | null }, []>('SELECT execution_ms, ceiling_ms FROM command_revision')
            .get();
          db.run(
            `INSERT INTO command_revision (execution_id, installation, incarnation, revision, operation_id, fingerprint, execution_ms, ceiling_ms, actor, cause, outcome, accepted_at) VALUES ('exec-old', ?, 0, 2, 'revise-none', 'revise/1', 90000, NULL, 'agent-1', 'longer', 'applied', ?)`,
            [INSTALLATION, at],
          );
          return {
            admitted,
            revised,
            unbounded: db
              .query<{ ceiling_ms: number | null }, []>("SELECT ceiling_ms FROM command_revision WHERE operation_id = 'revise-none'")
              .get(),
          };
        },
      });
      const command = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CommandAdmission))(saved.admitted?.command);
      expect(command).toEqual({ origin, limits: { executionMs: 60_000, executionCeilingMs: 600_000 }, policyIdentity: 'policy-1' });
      expect(originOf(command.limits)).toBe('caller');
      expect(saved.revised).toEqual({ execution_ms: 30_000, ceiling_ms: 600_000 });
      expect(saved.unbounded).toEqual({ ceiling_ms: null });
    }),
  );

  it.live('an installed custody row retains its holder and origin while its operation becomes a custody operation', () =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const saved = yield* withDatabase({
        path: ':memory:',
        use: (db) => {
          const { earlier, migration } = before('_custody_without_control');
          for (const item of earlier) for (const statement of item.sql) db.run(statement);
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (?, ?, ?, ?, ?, ?)',
            [0, INSTALLATION, '{}', 'open', 1, at],
          );
          db.run(
            `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, created_at, updated_at) VALUES ('exec-old', ?, 0, 'pty', 'held', 'command', 'running', 'eof', 'eof', 'open', 'pending', 'available', 'local', 'default', '/tmp', ?, ?)`,
            [INSTALLATION, at, at],
          );
          db.run(
            `INSERT INTO custody (execution_id, revision, holder, controller_principal, controller_binding, controller_generation, generation, origin, updated_at) VALUES ('exec-old', 2, 'operator', 'operator', 'tab-1', 2, 2, 'agent-1', ?)`,
            [at],
          );
          db.run(
            `INSERT INTO operation (installation, operation_id, kind, fingerprint, receipt, execution_id, created_at) VALUES (?, 'take-old', 'control', 'custody:take:0:server-old', ?, NULL, ?)`,
            [INSTALLATION, JSON.stringify({ _tag: 'CustodyAccepted', custody: { revision: 1, epoch: 1 } }), at],
          );
          for (const statement of migration.sql) db.run(statement);
          return {
            row: db.query<Record<string, unknown>, []>("SELECT * FROM custody WHERE execution_id = 'exec-old'").get(),
            operation: db
              .query<{ kind: string; receipt: string }, []>("SELECT kind, receipt FROM operation WHERE operation_id = 'take-old'")
              .get(),
          };
        },
      });
      expect(Object.keys(saved.row ?? {}).sort()).toEqual(['execution_id', 'holder', 'origin', 'revision', 'updated_at']);
      expect(saved.row).toMatchObject({ revision: 2, holder: 'operator', origin: 'agent-1' });
      expect(saved.operation?.kind).toBe('custody');
      expect(yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OperationReceipt))(saved.operation?.receipt)).toEqual({
        _tag: 'CustodyAccepted',
        custody: { revision: 1, epoch: 1 },
      });
    }),
  );

  it.live('reads an installed host custody key after its control kind migrates through the store', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const path = `${directory}/executions.sqlite`;
      const at = yield* Clock.currentTimeMillis;
      yield* installed({
        path,
        suffix: '_custody_without_control',
        at,
        use: (db) => {
          db.run(
            'INSERT INTO incarnation (incarnation, installation, registration, phase, current, entered_at) VALUES (?, ?, ?, ?, ?, ?)',
            [0, INSTALLATION, JSON.stringify(registrationOf(directory)), 'open', 1, at],
          );
          db.run(
            `INSERT INTO operation (installation, operation_id, kind, fingerprint, receipt, execution_id, created_at) VALUES (?, 'take-old', 'control', 'custody:take:0:server-old', ?, NULL, ?)`,
            [INSTALLATION, JSON.stringify({ _tag: 'CustodyAccepted', custody: { revision: 1, epoch: 1 } }), at],
          );
        },
      });
      const entry = yield* withStore({ directory, work: Effect.flatMap(ExecutionStore, (store) => store.operationOf(key('take-old'))) });
      expect(entry?.kind).toBe('custody');
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('reads null rule-copy options from installed metadata as absent while current admission rejects null', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const at = yield* Clock.currentTimeMillis;
      const origin = { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' };
      const copy = { id: 'rule-1', limitMs: 60_000, writer: 'operator', at: '2026-09-20T00:00:00.000Z', words: 'a minute' };
      const record = yield* withStore({
        directory,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          yield* withDatabase({
            path: `${directory}/executions.sqlite`,
            use: (db) => {
              const entered = db.query<{ incarnation: number }, []>('SELECT incarnation FROM incarnation WHERE current = 1').get();
              db.run(
                `INSERT INTO execution (execution_id, installation, incarnation, transport, lifetime, purpose, phase, stdout, stderr, pty, cleanup, record_availability, target_environment, target_namespace, target_cwd, command, created_at, updated_at) VALUES ('exec-old', ?, ?, 'pipes', 'command', 'command', 'running', 'open', 'open', 'eof', 'pending', 'available', 'local', 'default', '/tmp', ?, ?, ?)`,
                [
                  INSTALLATION,
                  entered?.incarnation ?? 0,
                  JSON.stringify({
                    origin,
                    limits: { executionMs: 60_000, origin: 'rule' },
                    policyIdentity: 'policy-1',
                    rules: [
                      { ...copy, thread: null, through: null },
                      { ...copy, id: 'rule-2', thread: 'thread-1', through: 'bash' },
                    ],
                  }),
                  at,
                  at,
                ],
              );
            },
          });
          return yield* store.executionOf(ref('exec-old').execution);
        }),
      });
      expect(record.command?.rules).toEqual([copy, { ...copy, id: 'rule-2', thread: 'thread-1', through: 'bash' }]);
      expect(
        Schema.decodeUnknownResult(CommandAdmission)({ origin, limits: {}, policyIdentity: 'p', rules: [{ ...copy, thread: null }] })._tag,
      ).toBe('Failure');
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

describe('loss', () => {
  it.live('owes cleanup after an uncertain launch is adopted in its continued generation', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      const request = launch({ execution: 'exec-adopted', key: 'start-adopted' });
      yield* withStore({
        directory,
        bound: 0,
        work: Effect.gen(function* () {
          yield* reserve(request);
          yield* (yield* ExecutionStore).uncertainStart(request.operation, request.ref, {
            _tag: 'NativeFailed',
            operation: request.operation,
            execution: request.ref,
            phase: 'starting',
            cleanup: 'unknown',
            reason: 'the launch reply was lost',
          });
        }),
      });
      const loss = yield* withStore({
        directory,
        processes: killable(),
        bound: 0,
        work: Effect.gen(function* () {
          const store = yield* ExecutionStore;
          yield* (yield* ExecutionCapacity).reserve(request.ref.execution, 'pipes');
          yield* store.adoptStart(request.operation, running(request.ref.execution), {});
          expect((yield* store.operationAnswerOf(request.operation))?.receipt._tag).toBe('Accepted');
          yield* killConnection();
          return yield* store.lost();
        }),
      });
      expect(loss.cleanup).toBe('owned');
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('fences writer loss while keeping spent keys refused after replacement', () =>
    Effect.gen(function* () {
      const directory = yield* temporary;
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
          const store = yield* ExecutionStore;
          const admission = yield* HostAdmission;
          yield* killConnection();
          const failure = yield* store.lost();
          expect(failure.cleanup).toBe('owned');
          expect(failure.reason.length).toBeGreaterThan(0);
          expect(
            yield* admission.phase().pipe(Effect.repeat({ until: (phase) => phase !== 'open', schedule: Schedule.spaced('1 millis') })),
          ).toBe('fenced');
          yield* admission.admit('read');
          expect((yield* Effect.flip(admission.admit('durable')))._tag).toBe('AdmissionRefused');
        }).pipe(Effect.provide(hostOver(directory, killable()))),
      );
      const survived = yield* withStore({ directory, work: Effect.flatMap(ExecutionStore, (store) => store.operationOf(key('start-1'))) });
      expect(survived?.receipt).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'IncarnationMismatch' } });
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('does not discharge another admission when two owners write one execution ending', () =>
    withStore({
      processes: killable(),
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        yield* reserve(launch({ execution: 'exec-2', key: 'start-2' }));
        const store = yield* ExecutionStore;
        yield* store.recordState(ended('exec-1'), {});
        yield* store.recordState(ended('exec-1'), {});
        yield* killConnection();
        expect((yield* store.lost()).cleanup).toBe('owned');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a custody transition asked after writer death returns typed loss rather than uncertainty', () =>
    withStore({
      processes: killable(),
      work: Effect.gen(function* () {
        const store = yield* ExecutionStore;
        yield* killConnection();
        yield* store.lost();
        expect(
          (yield* Effect.flip(
            store.acceptCustody({
              _tag: 'Take',
              operation: key('take-after-loss'),
              expected: 0,
              connection: ConnectionId.make('server-1'),
            }),
          ))._tag,
        ).toBe('StoreLost');
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live('a unit crossing writer death fails with the typed loss and its cleanup obligation', () =>
    withStore({
      processes: killable(),
      work: Effect.gen(function* () {
        yield* reserve(launch({ execution: 'exec-1', key: 'start-1' }));
        const store = yield* ExecutionStore;
        yield* (yield* ExecutionCapacity).reserve(ref('exec-2').execution, 'pipes');
        yield* killConnection();
        const crossing = yield* Effect.flip(
          store.reserve(launch({ execution: 'exec-2', key: 'start-2', fingerprint: 'command:echo two' })),
        );
        expect(crossing._tag).toBe('StoreLost');
        if (crossing._tag !== 'StoreLost') return yield* Effect.die(new Error(`crossing: ${crossing._tag}`));
        expect(crossing.reason.length).toBeGreaterThan(0);
        expect(['owned', 'unknown']).toContain(crossing.cleanup);
      }),
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
