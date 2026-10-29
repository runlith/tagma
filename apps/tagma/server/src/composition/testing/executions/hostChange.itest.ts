import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { Database } from 'bun:sqlite';
import { and, eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Data, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schedule, Schema, Scope, Tracer } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { ARTIFACT_FILE, ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { EXECUTIONS } from '../../../installation/contract/wire/manifest.js';
import { executionsLayer, type ExecutionServices } from '../../../executions/assembly.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { fixtureMigrations } from '../migrations.js';
import { logicYieldLayer } from '../../children.js';
import { claimHoldersLayer } from '../../hostClaims.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { ExecutionRecords } from '../../../executions/contract/service/records.js';
import { HostManagement, HostOffering } from '../../../executions/contract/service/host.js';
import { endHosts, hostsUnder, terminalIntent, terminalRequestKey } from '../../../executions/testing/doubles.js';
import { rootUse } from '../../../workspace/testing/doubles.js';
import { programRoadOver } from '../../../executions/ports.js';
import { EXTRA_MIGRATION, HostBundle, hostFixtureLayer, makeWorkspaceCase, migrated, HOST_LIBRARY as LIBRARY } from './fixture.js';

const manifestJson = Schema.fromJsonString(ArtifactManifest);
const stepThread = ThreadId.make('host-change-step');

class LedgerUnmeasured extends Data.TaggedError('LedgerUnmeasured')<{ readonly message: string; readonly cause: unknown }> {}

const hostMigrations = (state: string) =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => new Database(join(state, 'executions.sqlite'), { readonly: true }),
      catch: (cause) => new LedgerUnmeasured({ message: `Cannot open the host ledger of ${state}`, cause }),
    }),
    (db) =>
      Effect.try({
        try: () =>
          db
            .query<{ name: string }, []>('select name from __drizzle_migrations order by created_at, id')
            .all()
            .map((row) => row.name),
        catch: (cause) => new LedgerUnmeasured({ message: `Cannot read the host migrations of ${state}`, cause }),
      }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.withSpan('hostChange.migrations'));

const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const owner = yield* Effect.scope;
  const bundle = yield* HostBundle;
  const raised = yield* makeWorkspaceCase({ name: 'activation', prefix: 'host-change', threads: [stepThread] });
  const home = raised.caseHome;
  yield* Effect.addFinalizer(() => endHosts(home).pipe(Effect.orDie));
  const store = Context.get(raised.context, MachineStore);
  const units = Context.get(raised.context, MachineUnits);
  const lineage = yield* lineageOver(store, units);
  const closures = { before: join(home, 'before'), after: join(home, 'after') };
  for (const root of Object.values(closures)) {
    yield* files.makeDirectory(root, { recursive: true });
    yield* files.copy(bundle.root, join(root, EXECUTIONS));
  }
  yield* migrated(join(closures.after, EXECUTIONS));
  const scopes = new WeakMap<Context.Context<ExecutionServices>, Scope.Closeable>();
  const boot = Effect.fnUntraced(function* (root: string, takenAfter?: Effect.Effect<void>) {
    const scope = yield* Scope.fork(owner);
    const executions = yield* Layer.buildWithScope(
      executionsLayer.pipe(
        Layer.provide(
          Layer.succeed(HostOffering, {
            source: { _tag: 'Closure', path: join(root, EXECUTIONS) },
            migrations: fixtureMigrations,
            programVersion: 'host-change',
            takenAfter,
          }),
        ),
        Layer.provide(logicYieldLayer(undefined, join(root, EXECUTIONS))),
        Layer.provide(claimHoldersLayer),
        Layer.provide(Layer.succeed(ThreadLineage, lineage)),
        Layer.provide(Layer.succeed(RipgrepBinary, { path: () => Effect.die('this fixture does not search output') })),
        Layer.provide(HostRegistration.layer),
        Layer.provide(endpointConnection),
        Layer.provide(BunServices.layer),
      ),
      scope,
    ).pipe(
      Effect.provide(raised.context),
      Effect.onExit((ended) => (Exit.isFailure(ended) ? Scope.close(scope, ended) : Effect.void)),
    );
    scopes.set(executions, scope);
    return executions;
  });
  const leave = Effect.fnUntraced(function* (executions: Context.Context<ExecutionServices>) {
    const scope = scopes.get(executions);
    if (scope === undefined) return yield* Effect.die(new Error('this fixture did not create the executions layer'));
    yield* Scope.close(scope, Exit.void);
    scopes.delete(executions);
  });
  return { files, home, store, checkout: raised.checkout, projectId: raised.projectId, closures, boot, leave };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/HostChangeFixture') {}
const fixture = Layer.effect(
  Fixture,
  Effect.flatMap(HostBundle, (bundle) =>
    own(
      kind(Fixture, (_params: null) => makeFixture.pipe(Effect.provideService(HostBundle, bundle), Effect.provide(BunServices.layer))),
      null,
      'the subject is host activation after the server door opens',
    ),
  ),
).pipe(Layer.provide(hostFixtureLayer('host-change')), Layer.provideMerge(BunServices.layer));

const started = Effect.fnUntraced(function* (
  executions: Context.Context<ExecutionServices>,
  projectId: number,
  operation: string,
  script: string,
) {
  const { checkout } = yield* Fixture;
  const terminals = Context.get(executions, Terminals);
  const operator = principalOf({ _tag: 'Operator' });
  const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
  const receipt = yield* terminals.start({
    actor: { _tag: 'Operator' },
    operationId: HostRequestKey.make(operation),
    target,
    targetKey: targetKeyOf(targetIdentity(target, operator, operator)),
    program: '/bin/sh',
    args: ['-c', script],
    transport: 'pipes',
    lifetime: 'held',
  });
  if (receipt._tag !== 'Started') return yield* Effect.die(new Error(`${operation} did not start: ${receipt._tag}`));
  return receipt.record.execution;
});
const output = Effect.fnUntraced(function* (executions: Context.Context<ExecutionServices>, ref: ExecutionRef, from = 0n) {
  const records = Context.get(executions, ExecutionRecords);
  const parts: Uint8Array[] = [];
  let at = from;
  for (;;) {
    const read = yield* records.bytes({ ref, stream: 'stdout', offset: ByteOffset.make(String(at)) }, 64 * 1024);
    if (read.range.gap) return yield* Effect.die(new Error(`the record of ${ref.execution} has a gap at ${at}`));
    if (read.bytes.length === 0) return { text: Buffer.concat(parts).toString(), through: at };
    parts.push(read.bytes);
    at += BigInt(read.bytes.length);
  }
});
const until = Effect.fn('hostChange.await')(function* <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean, what: string) {
  yield* Effect.annotateCurrentSpan({ what });
  return yield* Effect.repeat(read, { until: done, schedule: Schedule.spaced('50 millis') });
});
const entered = Effect.fnUntraced(function* (name: string) {
  const reached = yield* Deferred.make<void>();
  const tracer = Tracer.make({
    span: (options) => {
      if (options.name === name) Deferred.doneUnsafe(reached, Exit.void);
      return new Tracer.NativeSpan(options);
    },
  });
  return { reached: Deferred.await(reached), tracer };
});
const counted = (text: string): readonly number[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => Number(line.slice(1)));

describe.skipIf(!existsSync(LIBRARY))('host activation after the server door', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect(
      'defers host migration and consumers until the door opens, lets a start interrupted before it return holding nothing, and releases consumers after a failed take-over',
      () =>
        Effect.gen(function* () {
          const { boot, leave, closures, files, home, store, projectId, checkout } = yield* Fixture;
          const intents = terminalIntent();
          const keys = terminalRequestKey();
          const uses = rootUse();
          const first = yield* boot(closures.before);
          const counter = yield* started(first, projectId, 'counter', 'i=0; while :; do echo n$i; i=$((i+1)); sleep 0.02; done');
          const prior = yield* until(output(first, counter), (read) => counted(read.text).length > 5, 'the counter');
          const state = Context.get(first, HostManagement).connection.address.state;
          const pids = yield* hostsUnder(home);
          const readManifest = () =>
            files.readFileString(join(state, 'bundle', ARTIFACT_FILE)).pipe(Effect.flatMap(Schema.decodeUnknownEffect(manifestJson)));
          const digest = (yield* readManifest()).identity.digest;
          const ledger = yield* hostMigrations(state);
          expect(ledger).not.toContain(EXTRA_MIGRATION);
          yield* leave(first);

          const opened = yield* Deferred.make<void>();
          const successor = yield* boot(closures.after, Deferred.await(opened));
          expect(yield* hostsUnder(home)).toEqual(pids);
          expect((yield* readManifest()).identity.digest).toBe(digest);
          expect(yield* hostMigrations(state)).toEqual(ledger);
          const terminals = Context.get(successor, Terminals);
          const host = Context.get(successor, HostManagement);
          const afterDoor = <A, E, R>(call: Effect.Effect<A, E, R>) =>
            call.pipe(Effect.tap(() => Effect.sync(() => expect(Deferred.isDoneUnsafe(opened)).toBe(true))));
          const earlyStart = yield* entered('Terminals.start');
          const early = yield* Effect.forkChild(
            afterDoor(started(successor, projectId, 'before-door', 'echo before-door')).pipe(Effect.withTracer(earlyStart.tracer)),
          );
          const read = yield* Effect.forkChild(afterDoor(terminals.state(counter)), { startImmediately: true });
          const world = yield* Effect.forkChild(afterDoor(host.connection.port.state(counter)), { startImmediately: true });
          const stepStart = yield* entered('Terminals.start');
          const step = yield* Effect.forkChild(
            programRoadOver(successor, '/bin/sh')
              .run({
                projectId,
                actor: { _tag: 'Thread', threadId: stepThread, projectId },
                argv: ['/bin/sh', '-c', 'echo interrupted'],
                cwd: checkout,
                stdin: '',
                tool: 'commit-step',
                operation: 'interrupted-before-door',
                subject: 'the commit step interrupted before the door',
              })
              .pipe(Effect.withTracer(stepStart.tracer)),
          );
          yield* stepStart.reached;
          yield* Fiber.interrupt(step);
          expect(Exit.hasInterrupts(yield* Fiber.await(step))).toBe(true);
          const leftBy = (operation: string) =>
            Effect.all({
              intent: store.db
                .select({ phase: intents.phase })
                .from(intents)
                .where(and(eq(intents.projectId, projectId), eq(intents.operationId, HostRequestKey.make(operation))))
                .get(),
              key: store.db
                .select({ outcome: keys.outcome })
                .from(keys)
                .where(and(eq(keys.projectId, projectId), eq(keys.operationId, HostRequestKey.make(operation))))
                .get(),
              uses: store.db
                .select({ state: uses.state })
                .from(uses)
                .where(and(eq(uses.consumerId, operation), eq(uses.state, 'held')))
                .all(),
            });
          expect(yield* leftBy('interrupted-before-door')).toEqual({ intent: undefined, key: undefined, uses: [] });
          yield* earlyStart.reached;
          expect((yield* Effect.result(host.connection.direct.state(counter)))._tag).toBe('Failure');
          expect(early.pollUnsafe()).toBeUndefined();
          expect(read.pollUnsafe()).toBeUndefined();
          expect(world.pollUnsafe()).toBeUndefined();
          yield* Deferred.succeed(opened, undefined);
          expect((yield* Fiber.join(read))?.state.phase).toBe('running');
          expect((yield* Fiber.join(world))?.state.phase).toBe('running');
          const echo = yield* Fiber.join(early);
          expect((yield* until(output(successor, echo), (read) => read.text.includes('before-door'), 'the early echo')).text).toContain(
            'before-door',
          );
          yield* until(host.standing, (standing) => standing.custodian, 'custody after the door');
          expect(yield* leftBy('interrupted-before-door')).toEqual({ intent: undefined, key: undefined, uses: [] });
          expect(yield* hostMigrations(state)).toEqual([...ledger, EXTRA_MIGRATION]);
          expect((yield* readManifest()).identity.digest).not.toBe(digest);
          yield* until(output(successor, counter, prior.through), (read) => counted(read.text).length > 5, 'the counter after taking over');
          const whole = counted((yield* output(successor, counter)).text);
          expect(whole).toEqual(whole.map((_, index) => index));
          yield* leave(successor);

          const door = yield* Deferred.make<void>();
          const failing = yield* boot(closures.before, Effect.andThen(Deferred.await(door), Effect.die(new Error('the take-over broke'))));
          const failedHost = Context.get(failing, HostManagement);
          const pending = yield* Effect.forkChild(
            Effect.result(failedHost.connection.port.state(counter)).pipe(
              Effect.tap(() => Effect.sync(() => expect(Deferred.isDoneUnsafe(door)).toBe(true))),
            ),
            { startImmediately: true },
          );
          expect((yield* Effect.result(failedHost.connection.direct.state(counter)))._tag).toBe('Failure');
          expect(pending.pollUnsafe()).toBeUndefined();
          yield* Deferred.succeed(door, undefined);
          expect((yield* Fiber.join(pending))._tag).toBe('Failure');
          const standing = yield* until(
            failedHost.standing,
            (now) => now.detail.includes('the take-over broke'),
            'the failed take-over named',
          );
          expect(standing.custodian).toBe(false);
          yield* leave(failing);
        }),
    );
  });
});
