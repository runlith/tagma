import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { and, eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Effect, Exit, FileSystem, Layer, Schedule, Scope } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { EXECUTIONS } from '../../../installation/contract/wire/manifest.js';
import { MachineHost } from '../../../installation/contract/service/machineHost.js';
import { executionsLayer, type ExecutionServices } from '../../../executions/assembly.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { fixtureMigrations } from '../migrations.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { HOST_REPLACED } from '../../../executions/contract/service/custody.js';
import { HostManagement, HostOffering, LogicYield } from '../../../executions/contract/service/host.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import { custodyNotice, endHosts, hostsUnder } from '../../../executions/testing/doubles.js';
import { HostBundle, hostFixtureLayer, makeWorkspaceCase, migrated, HOST_LIBRARY as LIBRARY } from './fixture.js';

const holder = ThreadId.make('host-replace-holder');

const withheld = LogicYield.of({ ask: () => Effect.succeed({ _tag: 'Unasked', detail: 'this fixture withholds the yield signal' }) });

const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const owner = yield* Effect.scope;
  const bundle = yield* HostBundle;
  const raised = yield* makeWorkspaceCase({ name: 'replace', prefix: 'host-replace', threads: [holder] });
  const home = raised.caseHome;
  yield* Effect.addFinalizer(() => endHosts(home).pipe(Effect.orDie));
  const store = Context.get(raised.context, MachineStore);
  const lineage = yield* lineageOver(store, Context.get(raised.context, MachineUnits));
  const closures = { before: join(home, 'before'), after: join(home, 'after') };
  for (const root of Object.values(closures)) {
    yield* files.makeDirectory(root, { recursive: true });
    yield* files.copy(bundle.root, join(root, EXECUTIONS));
  }
  yield* migrated(join(closures.after, EXECUTIONS));
  const boot = Effect.fnUntraced(function* (closure: string, replacing: boolean) {
    const scope = yield* Scope.fork(owner);
    const executions = yield* Layer.buildWithScope(
      executionsLayer.pipe(
        Layer.provide(
          Layer.succeed(HostOffering, {
            source: { _tag: 'Closure', path: join(closure, EXECUTIONS) },
            replacing,
            migrations: fixtureMigrations,
            programVersion: 'host-replace',
          }),
        ),
        Layer.provide(Layer.succeed(LogicYield, withheld)),
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
    return { executions, leave: Scope.close(scope, Exit.void) };
  });
  return { home, store, checkout: raised.checkout, projectId: raised.projectId, closures, boot };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/HostReplaceFixture') {}
const fixture = Layer.effect(
  Fixture,
  Effect.flatMap(HostBundle, (bundle) =>
    own(
      kind(Fixture, (_params: null) => makeFixture.pipe(Effect.provideService(HostBundle, bundle), Effect.provide(BunServices.layer))),
      null,
      'the subject is ending the standing execution host and raising another',
    ),
  ),
).pipe(Layer.provide(hostFixtureLayer('host-replace')), Layer.provideMerge(BunServices.layer));

const started = Effect.fnUntraced(function* (
  executions: Context.Context<ExecutionServices>,
  actor: TerminalActor,
  operation: string,
  transport: 'pty' | 'pipes',
  program: string,
  args: readonly string[],
) {
  const { checkout, projectId } = yield* Fixture;
  const terminals = Context.get(executions, Terminals);
  const principal = principalOf(actor);
  const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
  const receipt = yield* terminals.start({
    actor,
    operationId: HostRequestKey.make(operation),
    target,
    targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
    program,
    args,
    transport,
    lifetime: 'held',
    geometry: transport === 'pty' ? { rows: 24, columns: 80 } : undefined,
  });
  if (receipt._tag !== 'Started') return yield* Effect.die(new Error(`${operation} did not start: ${receipt._tag}`));
  return receipt.record.execution;
});

const until = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('50 millis') });

describe.skipIf(!existsSync(LIBRARY))('a new execution host', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect(
      'names what it would end by its foreground, then ends the standing host that does not take this server, raises its own and owes each holding thread a notice',
      () =>
        Effect.gen(function* () {
          const { boot, home, store, projectId, closures } = yield* Fixture;
          const operator: TerminalActor = { _tag: 'Operator' };
          const first = yield* boot(closures.before, false);
          const shell = yield* started(first.executions, { _tag: 'Thread', threadId: holder, projectId }, 'shell', 'pty', '/bin/sh', [
            '-l',
          ]);
          const sleeper = yield* started(first.executions, operator, 'sleeper', 'pty', '/bin/sh', ['-c', 'sleep 600; :']);
          const counter = yield* started(first.executions, operator, 'counter', 'pipes', '/bin/sh', ['-c', 'sleep 600']);
          const ends = yield* until(Context.get(first.executions, MachineHost).endings, (read) => (read?.length ?? 0) === 3);
          expect(
            Object.fromEntries((ends ?? []).map((ending) => [ending.execution, { activity: ending.activity, thread: ending.thread }])),
          ).toEqual({
            [shell.execution]: { activity: 'shell', thread: holder },
            [sleeper.execution]: { activity: 'program', thread: null },
            [counter.execution]: { activity: 'program', thread: null },
          });
          const standing = yield* hostsUnder(home);
          yield* first.leave;

          const second = yield* boot(closures.after, true);
          const host = Context.get(second.executions, HostManagement);
          expect((yield* until(host.standing, (now) => now.custodian)).stays).toBeUndefined();
          const raised = yield* hostsUnder(home);
          expect(raised.some((pid) => standing.includes(pid))).toBe(false);
          const notices = custodyNotice();
          expect(
            yield* store.db
              .select({ thread: notices.threadId, execution: notices.executionId })
              .from(notices)
              .where(and(eq(notices.projectId, projectId), eq(notices.requester, HOST_REPLACED)))
              .all(),
          ).toEqual([{ thread: holder, execution: shell.execution }]);
          const fresh = yield* started(second.executions, operator, 'fresh', 'pipes', '/bin/sh', ['-c', 'echo fresh']);
          expect(fresh.incarnation).toBeGreaterThan(shell.incarnation);
          yield* second.leave;
        }),
    );
  });
});
