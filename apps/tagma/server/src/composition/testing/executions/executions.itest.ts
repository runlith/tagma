import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { testSessionIdentityLayer } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { Git } from '@runlith/git/Git';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { digestOf, identityOf } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE, ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow, projectsLayer } from '../../../projects/testing/doubles.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { Environments } from '../../../workspace/contract/service/environments.js';
import { Coverage, FileRoots, RootUses } from '../../../workspace/contract/service/roots.js';
import { executionState, makeMachineWorld } from '../../../executions/testing/doubles.js';
import { executionsLayer } from '../../../executions/assembly.js';
import { ClaimHolders, HostOffering, LogicYield } from '../../../executions/contract/service/host.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { TerminalRecord } from '../../../executions/contract/wire/terminals.js';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import { ChildProcessSpawner } from 'effect/process';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const machineWorld = makeMachineWorld(() => null);
const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'terminals-layer-' });
  const checkout = join(home, 'checkout');
  yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
  const context = yield* Layer.build(
    hostWorkspace(machineWorld).pipe(
      Layer.provide(worktreeRecordsLayer),
      Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
      Layer.provideMerge(fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer()))),
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, { durable: false }, yield* sharedPool))),
      Layer.provideMerge(testSessionIdentityLayer),
    ),
  );
  yield* runGit(Context.get(context, Git), 'fixture', ['-C', checkout, 'init', '-q', '-b', 'main', '.']);
  const store = Context.get(context, MachineStore);
  const coverage = Context.get(context, Coverage);
  const now = new Date(yield* Clock.currentTimeMillis);
  const rows = yield* store.db
    .insert(projectRow())
    .values({
      name: 'terminals-layer',
      repoKey: 'terminals-layer',
      rootPath: checkout,
      createdAt: now,
    })
    .returning({ id: projectRow().id });
  yield* coverage.cover(rows[0]?.id ?? 0);
  return context;
});

const recoveryScript = [
  '#!/bin/sh',
  'case "$3" in',
  '  list) printf \'%s\\n\' "11111111-1111-4111-8111-111111111111 5 running pty cleanup pending record available" ;;',
  "  shutdown) printf 'ShutdownComplete\\n' ;;",
  'esac',
  '',
].join('\n');

it.live('each thread holding a terminal on a host without a holder is owed one notice, and a thread holding none is owed none', () =>
  Effect.gen(function* () {
    const context = yield* makeFixture;
    const files = yield* FileSystem.FileSystem;
    const store = Context.get(context, MachineStore);
    const units = Context.get(context, MachineUnits);
    const environments = Context.get(context, Environments);
    const { identity } = yield* environments.inspect('host');
    const installation = InstallationId.make(identity.environmentId);
    const state = executionState(store.path, identity.environmentId);
    const bundle = join(state, 'bundle');
    yield* files.makeDirectory(join(bundle, 'recovery'), { recursive: true });
    const declared = {
      protocol: 'executions/1' as const,
      platform: { os: process.platform, arch: process.arch },
      endpoint: { transport: 'unix', path: 'host.sock' },
      wire: { min: 1, max: 1 },
      parts: ['runtime', 'host', 'platform'].map((role) => ({
        role: role as 'runtime',
        path: role,
        bytes: 1,
        digest: digestOf(new TextEncoder().encode(role)),
      })),
    };
    yield* files.writeFileString(
      join(bundle, ARTIFACT_FILE),
      Schema.encodeSync(Schema.fromJsonString(ArtifactManifest))({
        identity: { digest: identityOf(declared), build: 'older' },
        ...declared,
      }),
    );
    yield* files.writeFileString(join(bundle, 'bun'), recoveryScript, { mode: 0o700 });
    const rows = storesOver(store.db, installation);
    const project = (yield* units.read((unit) => unit.run(store.db.select({ id: projectRow().id }).from(projectRow()).limit(1))))[0]!.id;
    const recordOf = (execution: string, heldBy: string | undefined): TerminalRecord => ({
      projectId: project,
      execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
      transport: 'pty',
      lifetime: 'held',
      targetKey: 'k' as never,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      revision: 1 as never,
      holdings: {},
      acceptedAt: 0,
      heldBy: heldBy === undefined ? undefined : ThreadId.make(heldBy),
    });
    const holding = recordOf('11111111-1111-4111-8111-111111111111', 'thread-holding');
    const unheld = recordOf('22222222-2222-4222-8222-222222222222', undefined);
    yield* units.write('first-enabling', (unit) =>
      Effect.all([rows.terminalRows.project(unit, holding), rows.terminalRows.project(unit, unheld)]),
    );
    const deps = Layer.mergeAll(
      Layer.succeed(MachineStore, store),
      Layer.succeed(MachineUnits, units),
      Layer.succeed(Environments, environments),
      Layer.succeed(FileRoots, Context.get(context, FileRoots)),
      Layer.succeed(RootUses, Context.get(context, RootUses)),
      Layer.succeed(Coverage, Context.get(context, Coverage)),
      Layer.succeed(CheckoutPaths, Context.get(context, CheckoutPaths)),
      Layer.effect(ThreadLineage, lineageOver(store, units)),
      Layer.succeed(Settings, Context.get(context, Settings)),
      HostRegistration.layer,
      endpointConnection,
      testSessionIdentityLayer,
    ).pipe(Layer.provideMerge(platform));
    yield* Effect.scoped(
      Layer.build(
        executionsLayer.pipe(
          Layer.provide(deps),
          Layer.provide(Layer.succeed(HostOffering, { source: undefined, migrations: fixtureMigrations, programVersion: 'fixture' })),
          Layer.provide(Layer.succeed(LogicYield, { ask: () => Effect.succeed({ _tag: 'Unasked', detail: 'no platform here' } as const) })),
          Layer.provide(Layer.succeed(ClaimHolders, { of: () => Effect.succeed({ _tag: 'Holders', pids: [] } as const) })),
          Layer.provide(Layer.succeed(RipgrepBinary, { path: () => Effect.die('no output search runs here') })),
          Layer.provide(
            Layer.succeed(
              ChildProcessSpawner.ChildProcessSpawner,
              ChildProcessSpawner.make(() => Effect.die('no process runs here')),
            ),
          ),
        ),
      ),
    );
    const notices = yield* units.read((unit) => rows.terminalRows.notices(unit, 100));
    expect(notices.map((notice) => [notice.thread, notice.operationId, notice.state])).toEqual([
      ['thread-holding', `replaced:${holding.execution.execution}:0`, 'owed'],
    ]);
  }).pipe(Effect.provide(platform)),
);
