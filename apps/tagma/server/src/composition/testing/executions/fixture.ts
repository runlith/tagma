import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { kind, shared } from '@runlith/testbed/worlds';
import { join } from 'node:path';
import { digestOf, holderEntryOf, identityOf, readArtifact } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE, ArtifactManifest, HOLDER_ENTRY_FILE } from '@runlith/executions/protocol/artifact';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { prepareHostFixture, startHostFixture } from '../../../executions/testing/hostFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { sessionIdentityLayer } from '../../../external-harnesses/testing/builtin.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { projectsLayer, project } from '../../../projects/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { fixtureMigrations } from '../migrations.js';
import { REPO_ROOT } from '../repoRoot.js';
import { hostBundleRoot } from '../hostBundle.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

export const HOST_LIBRARY = join(REPO_ROOT, 'packages/execution-host/native/target/release/libexecution_platform.dylib');
const machineWorld = makeMachineWorld(() => null);

export class HostBundle extends Context.Service<
  HostBundle,
  {
    readonly root: string;
    readonly manifest: ArtifactManifest;
  }
>()('testing/executions/HostBundle') {}

const makeBundle = Effect.fn('ExecutionFixture.bundle')(function* () {
  const root = yield* hostBundleRoot;
  return HostBundle.of({ root, manifest: yield* readArtifact(root) });
});

export const hostBundleWorld = kind(HostBundle, (_params: null) => makeBundle().pipe(Effect.provide(BunFileSystem.layer)));

export const EXTRA_MIGRATION = '29991231000000_stest_extra';

const manifestJson = Schema.fromJsonString(ArtifactManifest);

export const migrated = Effect.fn('ExecutionFixture.migrated')(function* (bundle: string) {
  const files = yield* FileSystem.FileSystem;
  const manifest = yield* files.readFileString(join(bundle, ARTIFACT_FILE)).pipe(Effect.flatMap(Schema.decodeUnknownEffect(manifestJson)));
  const like = manifest.parts.find((one) => one.path.startsWith('drizzle/'));
  if (like === undefined) return yield* Effect.die(new Error('the bundle carries no migrations'));
  const path = `drizzle/${EXTRA_MIGRATION}/migration.sql`;
  const bytes = new TextEncoder().encode('CREATE TABLE `stest_extra` (`x` integer);\n');
  yield* files.makeDirectory(join(bundle, 'drizzle', EXTRA_MIGRATION), { recursive: true });
  yield* files.writeFile(join(bundle, path), bytes, { mode: 0o600 });
  const parts = [...manifest.parts, { ...like, path, bytes: bytes.length, digest: digestOf(bytes) }];
  const next = { ...manifest, parts, identity: { ...manifest.identity, digest: identityOf({ ...manifest, parts }) } };
  const entry = holderEntryOf(next);
  if (entry === undefined) return yield* Effect.die(new Error('the bundle has no holder entry'));
  yield* files.writeFileString(join(bundle, ARTIFACT_FILE), yield* Schema.encodeEffect(manifestJson)(next));
  yield* files.writeFileString(join(bundle, HOLDER_ENTRY_FILE), entry);
});

export const hostFixtureLayer = (_name: string) => Layer.effect(HostBundle, shared(hostBundleWorld, null));

class CheckoutSeed extends Context.Service<CheckoutSeed, string>()('testing/executions/CheckoutSeed') {}
const checkoutSeed = kind(CheckoutSeed, (_params: null, home: string) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const checkout = join(home, 'checkout');
    yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
    yield* files.writeFileString(join(checkout, 'src/a.ts'), 'export const one = 1;\n');
    for (const args of [
      ['init', '-q', '-b', 'main', checkout],
      ['-C', checkout, 'add', '--', 'src'],
      ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'as it stood'],
    ]) {
      const ran = yield* spawnedEffect(['git', ...args]);
      if (!ran.success) return yield* Effect.die(new Error(ran.stderr.toString()));
    }
    return checkout;
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

type WorkspaceCaseInput = {
  readonly name: string;
  readonly prefix: string;
  readonly threads: readonly ThreadId[];
};

export const makeWorkspaceCase = Effect.fn('ExecutionFixture.workspace')(function* ({ name, prefix, threads }: WorkspaceCaseInput) {
  const files = yield* FileSystem.FileSystem;
  const caseHome = yield* files.makeTempDirectoryScoped({ prefix: `${prefix}-${name}-` });
  const anchor = join(caseHome, 'anchor');
  yield* files.makeDirectory(anchor, { recursive: true });
  const checkout = join(caseHome, 'checkout');
  yield* files.copy(yield* shared(checkoutSeed, null), checkout, { overwrite: true });
  const processes = yield* sharedPool;
  const context = yield* Layer.build(
    hostWorkspace(machineWorld).pipe(
      Layer.provide(worktreeRecordsLayer),
      Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
      Layer.provideMerge(fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer()))),
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(anchor, 'db.sqlite'), fixtureMigrations, { durable: false }, processes))),
      Layer.provideMerge(sessionIdentityLayer),
    ),
  );
  const store = Context.get(context, MachineStore);
  const now = new Date(yield* Clock.currentTimeMillis);
  const rows = yield* store.db
    .insert(project())
    .values({
      name: `${prefix}-${name}`,
      repoKey: `${prefix}-${name}`,
      rootPath: checkout,
      createdAt: now,
    })
    .returning({ id: project().id });
  const projectId = rows[0]!.id;
  for (const id of threads)
    yield* bornThread(
      store.db,
      {
        id,
        ownerId: 'owner',
        agentId: 'tagma',
        spawnRootId: id,
        cacheGroup: id,
        authority: THREAD_AUTHORITY_DEFAULT,
        createdAt: now,
        updatedAt: now,
      },
      { projectId },
    );
  yield* Context.get(context, Coverage).cover(projectId);
  return { name, caseHome, anchor, checkout, context, projectId };
});

export type WorkspaceCase = Effect.Success<ReturnType<typeof makeWorkspaceCase>>;

type FixtureHostInput = {
  readonly state: string;
  readonly installation: InstallationId;
  readonly policy?: ExecutionPolicy;
};

export const makeFixtureHost = Effect.fn('ExecutionFixture.host')(function* ({ state, installation, policy }: FixtureHostInput) {
  const files = yield* FileSystem.FileSystem;
  const bundle = yield* HostBundle;
  yield* files.makeDirectory(state, { recursive: true, mode: 0o700 });
  const canonical = yield* files.realPath(state);
  const command = yield* prepareHostFixture(canonical, installation, bundle.root, policy);
  const child = yield* startHostFixture({ state: canonical, command });
  return { canonical, child, bundle };
});

export type FixtureHost = Effect.Success<ReturnType<typeof makeFixtureHost>>;

type HostCaseInput = {
  readonly name: string;
  readonly installation: InstallationId;
  readonly threads: readonly ThreadId[];
  readonly policy?: ExecutionPolicy;
};

export const makeHostCase = Effect.fn('ExecutionFixture.case')(function* ({ name, installation, threads, policy }: HostCaseInput) {
  const workspace = yield* makeWorkspaceCase({ name, prefix: installation, threads });
  const host = yield* makeFixtureHost({ state: join(workspace.caseHome, 'host'), installation, policy });
  return { ...workspace, ...host };
});

export type HostCase = Effect.Success<ReturnType<typeof makeHostCase>>;
