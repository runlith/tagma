import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { existsSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Context, Effect, Exit, FileSystem, Layer, Schedule, Schema, Scope } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { processInvocation } from '../../../platform/cli/verb.js';
import type { InstallationDoor } from '../../../installation/cli/port.js';
import { CHANNELS } from '../../../installation/contract/wire/channel.js';
import { EXECUTIONS } from '../../../installation/contract/wire/manifest.js';
import { INSTALLATION_OPERATIONS } from '../../../installation/contract/wire/operations.js';
import { InstalledChannel } from '../../../installation/contract/service/channel.js';
import { MachineHost } from '../../../installation/contract/service/machineHost.js';
import { SuccessionSteps } from '../../../installation/contract/service/steps.js';
import { Succession } from '../../../installation/contract/service/succession.js';
import { readAttempt } from '../../../installation/closure/attempt.js';
import { releaseAt } from '../../../installation/closure/manifests.js';
import { checkSuccessor } from '../../../installation/operations/restart.js';
import { successionLayer } from '../../../installation/process/succession.js';
import { newHostOf, waitingOf } from '../../../installation/newHost.js';
import { installRelease } from '../../../release-channel/install.js';
import { weighedByServer } from '../../../release-channel/successor.js';
import { carriedIn, serverless, syntheticReleaseEffect, trustedApplications } from '../../../release-channel/testing/release.js';
import { executionsLayer } from '../../../executions/assembly.js';
import { hostBundleNext } from '../../../executions/host/offer.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { HostManagement, HostOffering, LogicYield } from '../../../executions/contract/service/host.js';
import { claimHoldersLayer } from '../../hostClaims.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import { endHosts } from '../../../executions/testing/doubles.js';
import { fixtureMigrations } from '../migrations.js';
import { HostBundle, hostFixtureLayer, makeWorkspaceCase, migrated, HOST_LIBRARY as LIBRARY } from './fixture.js';

const operator: Caller = { actor: { kind: 'operator' }, files: null };
const channel = CHANNELS.stable;
const withheld = LogicYield.of({ ask: () => Effect.succeed({ _tag: 'Unasked', detail: 'this fixture asks no host to yield' }) });

const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const owner = yield* Effect.scope;
  const bundle = yield* HostBundle;
  const raised = yield* makeWorkspaceCase({ name: 'held', prefix: 'held-release', threads: [] });
  const home = raised.caseHome;
  yield* Effect.addFinalizer(() => endHosts(home).pipe(Effect.orDie));
  const installRoot = join(home, 'install');
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const before = process.env.TAGMA_INSTALL_ROOT;
      process.env.TAGMA_INSTALL_ROOT = installRoot;
      return before;
    }),
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env.TAGMA_INSTALL_ROOT;
        else process.env.TAGMA_INSTALL_ROOT = before;
      }),
  );
  const lineage = yield* lineageOver(Context.get(raised.context, MachineStore), Context.get(raised.context, MachineUnits));
  const standing = join(home, 'standing');
  yield* files.makeDirectory(standing, { recursive: true });
  yield* files.copy(bundle.root, join(standing, EXECUTIONS));
  yield* migrated(join(standing, EXECUTIONS));
  const scope = yield* Scope.fork(owner);
  const executions = yield* Layer.buildWithScope(
    executionsLayer.pipe(
      Layer.provide(
        Layer.succeed(HostOffering, {
          source: { _tag: 'Closure', path: join(standing, EXECUTIONS) },
          replacing: false,
          migrations: fixtureMigrations,
          programVersion: 'held-release',
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
  const release = Effect.fnUntraced(function* (build: string, host: string | undefined) {
    const app = join(home, build, 'Tagma.app');
    yield* syntheticReleaseEffect(app, build, undefined, undefined, host);
    return carriedIn(app);
  });
  return { home, installRoot, executions, release, checkout: raised.checkout, projectId: raised.projectId, standing, plain: bundle.root };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/HeldReleaseFixture') {}
const fixture = Layer.effect(
  Fixture,
  Effect.flatMap(HostBundle, (bundle) =>
    own(
      kind(Fixture, (_params: null) => makeFixture.pipe(Effect.provideService(HostBundle, bundle), Effect.provide(BunServices.layer))),
      null,
      'the subject sets TAGMA_INSTALL_ROOT for the install-from a consent runs',
    ),
  ),
).pipe(Layer.provide(hostFixtureLayer('held-release')), Layer.provideMerge(BunServices.layer));

const until = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('50 millis') });

describe.skipIf(!existsSync(LIBRARY))('a published release the standing execution host does not take', () => {
  layer(fixture, { excludeTestServices: true })('install-from', (it) => {
    it.effect(
      'stays beside the release that runs with what a new host ends, until the restart that consents to one makes it current; a release the host takes becomes current',
      () =>
        Effect.gen(function* () {
          const { installRoot, executions, release, checkout, projectId, standing, plain } = yield* Fixture;
          const place = { installRoot, launcher: join(installRoot, '..', 'bin/tagma'), name: channel.name };
          const at = () => Effect.map(Clock.currentTimeMillis, (now) => new Date(now));
          const first = yield* installRelease(
            yield* release('0.1.0', undefined),
            place,
            trustedApplications,
            yield* at(),
            false,
            serverless,
          );
          if (first.status !== 'landed') return yield* Effect.die(new Error(`0.1.0 did not land: ${JSON.stringify(first)}`));
          const runsFrom = { root: first.root, manifest: releaseAt(installRoot, first.version)! };
          const succession = Context.get(
            yield* Layer.build(
              successionLayer(
                runsFrom,
                installRoot,
                join(installRoot, '..', 'serve.log'),
                () => {},
                undefined,
                undefined,
                undefined,
                Effect.succeed(Context.get(executions, SuccessionSteps)),
              ),
            ),
            Succession,
          );
          const door: InstallationDoor = {
            operations: {
              perform: ({ params, payload }) =>
                params.id === 'check_successor'
                  ? Schema.decodeUnknownEffect(INSTALLATION_OPERATIONS.check_successor.input)(payload).pipe(
                      Effect.flatMap((input) => checkSuccessor.body.execute(input, undefined, operator)),
                      Effect.provideService(Succession, succession),
                      Effect.provideService(InstalledChannel, channel),
                    )
                  : Effect.die(new Error(`install-from asks only check_successor, not ${params.id}`)),
            },
          };
          const invocation = processInvocation();
          const weigh = weighedByServer({ ask: (call) => call(door, invocation), here: (at) => ({ cwd: at.cwd }) });

          const terminals = Context.get(executions, Terminals);
          const actor: TerminalActor = { _tag: 'Operator' };
          const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
          const principal = principalOf(actor);
          const started = yield* terminals.start({
            actor,
            operationId: HostRequestKey.make('sleeper'),
            target,
            targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
            program: '/bin/sh',
            args: ['-c', 'sleep 600'],
            transport: 'pipes',
            lifetime: 'held',
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`the sleeper did not start: ${started._tag}`));
          const sleeper = started.record.execution.execution;
          const machineHost = Context.get(executions, MachineHost);
          yield* until(machineHost.endings, (ends) => ends?.some((ending) => ending.execution === sleeper) === true);

          const refused = yield* installRelease(yield* release('0.2.0', plain), place, trustedApplications, yield* at(), false, weigh);
          expect(refused).toMatchObject({ status: 'held', build: '0.2.0', standing: '0.1.0' });
          if (refused.status !== 'held') return;
          expect(readlinkSync(join(installRoot, 'current'))).toBe(first.version);
          expect(readAttempt(installRoot)?.to).toBe(first.version);
          expect(existsSync(hostBundleNext(Context.get(executions, HostManagement).connection.address.state))).toBe(false);
          const current = yield* succession.current;
          const runs = { build: '0.1.0', digest: runsFrom.manifest.identity.digest };
          const newHost = yield* newHostOf(
            succession,
            machineHost,
            waitingOf(current, runs, yield* succession.refused),
            '0.1.0',
            null,
            null,
          );
          expect(newHost).toMatchObject({ cause: 'update', build: '0.2.0' });
          expect(newHost?.ends?.map((ending) => ending.execution)).toContain(sleeper);

          const plainly = yield* Effect.flip(succession.restart());
          expect(plainly._tag).toBe('HostUnprepared');
          expect(readlinkSync(join(installRoot, 'current'))).toBe(first.version);
          const consented = yield* Effect.flip(succession.restart('replace'));
          expect(consented._tag).toBe('SuccessorFailed');
          expect(readlinkSync(join(installRoot, 'current'))).toBe(refused.version);
          expect(readAttempt(installRoot)?.to).toBe(refused.version);

          const taken = yield* installRelease(
            yield* release('0.3.0', join(standing, EXECUTIONS)),
            place,
            trustedApplications,
            yield* at(),
            false,
            weigh,
          );
          expect(taken).toMatchObject({ status: 'landed', build: '0.3.0' });
          if (taken.status !== 'landed') return;
          expect(readlinkSync(join(installRoot, 'current'))).toBe(taken.version);
        }),
    );
  });
});
