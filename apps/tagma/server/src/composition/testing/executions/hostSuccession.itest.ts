import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Effect, Exit, Fiber, FileSystem, Layer, Schedule, Scope } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { REGISTRATION_FILE } from '@runlith/executions/protocol/registration';
import { EXECUTIONS } from '../../../installation/contract/wire/manifest.js';
import { executionsLayer, type ExecutionServices } from '../../../executions/assembly.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import { fixtureMigrations } from '../migrations.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { HostManagement, HostOffering, LogicYield } from '../../../executions/contract/service/host.js';
import { claimHoldersLayer } from '../../hostClaims.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import { endHosts, hostsUnder } from '../../../executions/testing/doubles.js';
import { HostBundle, hostFixtureLayer, makeWorkspaceCase, migrated } from './fixture.js';

const withheld = LogicYield.of({ ask: () => Effect.succeed({ _tag: 'Unasked', detail: 'this fixture withholds the yield signal' }) });

const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const owner = yield* Effect.scope;
  const bundle = yield* HostBundle;
  const raised = yield* makeWorkspaceCase({ name: 'succession', prefix: 'host-succession', threads: [] });
  const home = raised.caseHome;
  yield* Effect.addFinalizer(() => endHosts(home).pipe(Effect.orDie));
  const store = Context.get(raised.context, MachineStore);
  const lineage = yield* lineageOver(store, Context.get(raised.context, MachineUnits));
  const closure = join(home, 'closure');
  yield* files.makeDirectory(closure, { recursive: true });
  yield* files.copy(bundle.root, join(closure, EXECUTIONS));
  yield* migrated(join(closure, EXECUTIONS));
  const boot = Effect.gen(function* () {
    const scope = yield* Scope.fork(owner);
    const executions = yield* Layer.buildWithScope(
      executionsLayer.pipe(
        Layer.provide(
          Layer.succeed(HostOffering, {
            source: { _tag: 'Closure', path: join(closure, EXECUTIONS) },
            migrations: fixtureMigrations,
            programVersion: 'host-succession',
          }),
        ),
        Layer.provide(Layer.succeed(LogicYield, withheld)),
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
    return { executions, leave: Scope.close(scope, Exit.void) };
  });
  return { home, checkout: raised.checkout, projectId: raised.projectId, boot };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/HostSuccessionFixture') {}
const fixture = Layer.effect(
  Fixture,
  Effect.flatMap(HostBundle, (bundle) =>
    own(
      kind(Fixture, (_params: null) => makeFixture.pipe(Effect.provideService(HostBundle, bundle), Effect.provide(BunServices.layer))),
      null,
      'the subject is a running server bringing up a successor for the execution host that left it',
    ),
  ),
).pipe(Layer.provide(hostFixtureLayer('host-succession')), Layer.provideMerge(BunServices.layer));

const started = Effect.fnUntraced(function* (
  executions: Context.Context<ExecutionServices>,
  operation: string,
  script = `echo ${operation}`,
) {
  const { checkout, projectId } = yield* Fixture;
  const terminals = Context.get(executions, Terminals);
  const actor: TerminalActor = { _tag: 'Operator' };
  const principal = principalOf(actor);
  const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
  const receipt = yield* terminals.start({
    actor,
    operationId: HostRequestKey.make(operation),
    target,
    targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
    program: '/bin/sh',
    args: ['-c', script],
    transport: 'pipes',
    lifetime: 'held',
  });
  if (receipt._tag !== 'Started') return yield* Effect.die(new Error(`${operation} did not start: ${receipt._tag}`));
  return receipt.record.execution;
});

const until = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('50 millis') });

describe('a running server whose execution host left', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect('raises a successor on the next start and runs it there, under a later generation', () =>
      Effect.gen(function* () {
        const { boot, home } = yield* Fixture;
        const server = yield* boot;
        const host = Context.get(server.executions, HostManagement);
        expect((yield* until(host.standing, (now) => now.custodian)).boot._tag).toBe('Raised');
        const first = yield* started(server.executions, 'before-leaving');
        const standing = yield* hostsUnder(home);
        expect(standing.length).toBeGreaterThan(0);
        yield* endHosts(home);
        const after = yield* started(server.executions, 'after-leaving');
        expect(after.incarnation).toBeGreaterThan(first.incarnation);
        const raised = yield* hostsUnder(home);
        expect(raised.some((pid) => standing.includes(pid))).toBe(false);
        expect((yield* host.standing).custodian).toBe(true);
        yield* server.leave;
      }),
    );

    it.effect('ends a host whose logic came back into a shutdown it never finished, then raises a successor for the start', () =>
      Effect.gen(function* () {
        const { boot } = yield* Fixture;
        const files = yield* FileSystem.FileSystem;
        const server = yield* boot;
        const host = Context.get(server.executions, HostManagement);
        yield* until(host.standing, (now) => now.custodian);
        const wedged = yield* started(server.executions, 'wedged', 'trap "" INT TERM; sleep 600');
        const state = host.connection.address.state;
        const direct = host.connection.direct;
        const logicOf = Effect.map(
          files.readFileString(join(state, REGISTRATION_FILE)),
          (text) => (JSON.parse(text) as { readonly logic?: { readonly pid: number } }).logic?.pid,
        );
        const sweeping = yield* Effect.forkScoped(
          direct.shutdown({ installation: host.connection.installation, operation: HostRequestKey.make('succession-sweep') }),
        );
        yield* until(Effect.result(direct.status()), (seen) => seen._tag === 'Success' && seen.success.phase === 'stopping');
        const killed = yield* logicOf;
        if (killed === undefined) return yield* Effect.die(new Error('the host registration names no logic'));
        process.kill(killed, 'SIGKILL');
        yield* until(logicOf, (pid) => pid !== undefined && pid !== killed);
        const reopened = yield* until(
          Effect.result(direct.status()),
          (seen) => seen._tag === 'Success' && seen.success.incarnation === wedged.incarnation,
        );
        expect(reopened._tag === 'Success' ? reopened.success.phase : undefined).toBe('stopping');
        yield* Fiber.interrupt(sweeping);
        const after = yield* started(server.executions, 'after-stopping');
        expect(after.incarnation).toBeGreaterThan(wedged.incarnation);
        expect((yield* host.standing).custodian).toBe(true);
        yield* server.leave;
      }),
    );
  });
});
