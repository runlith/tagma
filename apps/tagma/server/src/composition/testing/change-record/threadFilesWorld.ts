import { retiredAt } from '../../../change-record/testing/holdings.js';
import { kind, shared } from '@runlith/testbed/worlds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../migrations.js';
import { holderKey } from '../../../workspace/contract/wire/checkout.js';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Context, Effect, FileSystem, Layer, Path } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import type { IntakeRefused, WorkspaceChanges } from '@runlith/agent-tools/WorkspaceChanges';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/store/table.js';
import { projectRoot } from '../../../workspace/store/tables.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { quietCommands } from '../../../change-record/testing/doubles.js';
import type { PathAuthorship } from '../../../change-record/contract/wire/authorship.js';
import type { ThreadChangesFrame, ThreadEntry } from '../../../change-record/contract/wire/threadChanges.js';
import { fileRootStore, gitCheckoutRows, rootRegistry } from '../../../workspace/testing/doubles.js';
import type { RootReservations } from '../../../workspace/contract/service/roots.js';
import { EnvironmentId } from '../../../workspace/contract/wire/environments.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import type { WorkingRoot } from '../../../workspace/contract/wire/place.js';
import { authorshipOver } from '../../../change-record/threadFiles/authorship.js';
import { threadChangesOver } from '../../../change-record/changes/stream.js';
import { heldFeed } from '../../../change-record/record/held.js';
import { judgedChange, makeJudges } from '../../../change-record/holdings/judges.js';
import { makeGitMetadata } from '../../../change-record/record/metadata.js';
import { FoldMemory } from '../../../change-record/lines/memory.js';
import { makeWalks, type Walks } from '../../../change-record/lines/walks.js';
import { CheckoutRows, GraphDirectory } from '../../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import type { HeldChange, HeldFeed } from '../../../change-record/contract/service/held.js';
import { changeRecordOf, intakeOf } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { expect } from 'bun:test';
export const provenance = { kind: 'adoption', id: 'operator' };
export const namespaceId = NamespaceId.make('test-thread-files');
export const unreserved: RootReservations['Service'] = { holding: () => Effect.succeed(new Map()) };
export const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
export const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { readers: 1, durable: false }, pool))),
  ),
);
const platform = Layer.mergeAll(BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)));
export const PROJECT = 1;
export const MINE = 'thread-mine';
export const THEIRS = 'thread-theirs';
export const GONE = 'thread-gone';
export const BORN = 'one\n';
export const GROWN = 'one\ntwo\n';
export const WIDE_LINES = 40;
export const WIDE_BORN = `${Array.from({ length: WIDE_LINES }, (_, at) => `line ${at + 1}`).join('\n')}\n`;
export const WIDE_GROWN = WIDE_BORN.replace('line 2\n', 'line two\n').replace('line 38\n', 'line thirty-eight\n');
export const run = (git: Git['Service'], cwd: string, args: readonly string[]): Effect.Effect<string> =>
  Effect.orDie(
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(`git ${args.join(' ')} in ${cwd}: ${answer.stderr}`),
    ),
  );
export const NAMES: Readonly<Record<string, string>> = { [MINE]: 'reader', [GONE]: 'gone' };
export const agent = (id: string, status: 'idle' | 'failed' = 'idle', name?: string) => ({
  id,
  status,
  name,
  ownerId: 'owner',
  agentId: 'tagma',
  spawnRootId: id,
  cacheGroup: id,
  provider: 'openai-oauth' as const,
  model: 'gpt-test',
  reasoning: 'high' as const,
  authority: { mode: 'trust' as const, bypassFrom: null },
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
export const edited = Effect.fnUntraced(function* (
  port: WorkspaceChanges,
  at: string,
  before: string,
  after: string,
): Effect.fn.Return<boolean, IntakeRefused> {
  const hunk = workspaceChangeHunk(before, after);
  return yield* Effect.map(
    port.land(
      [
        {
          origin: 'edit',
          path: at,
          at: new Date(yield* Clock.currentTimeMillis),
          hunk,
          before: contentDigest(before),
          after: contentDigest(after),
          beforeText: before,
          afterText: after,
          mode: '100644',
        },
      ],
      Effect.succeed(true),
    ),
    (landed) => landed._tag === 'written' && landed.kept,
  );
});
export const record = (
  port: WorkspaceChanges,
  change: Parameters<WorkspaceChanges['land']>[0][number],
): Effect.Effect<boolean, IntakeRefused> =>
  Effect.map(port.land([change], Effect.succeed(true)), (landed) => landed._tag === 'written' && landed.kept);
export const counted = (git: Git['Service']) => {
  const blobs = { read: 0 };
  const objects = git.objects;
  const faces: Git['Service'] = {
    run: (args, options) => {
      if (args.some((arg) => arg.startsWith('HEAD:')) || (typeof options?.stdin === 'string' && options.stdin.includes('HEAD:')))
        blobs.read += 1;
      return git.run(args, options);
    },
    objects:
      objects === undefined
        ? undefined
        : (dir: string, oids: readonly string[], options?: Parameters<NonNullable<Git['Service']['objects']>>[2]) =>
            Effect.tap(objects(dir, oids, options), (answers) =>
              Effect.sync(() => {
                for (const answer of answers) if (answer._tag === 'Success' && answer.success?.type === 'blob') blobs.read += 1;
              }),
            ),
  };
  return { faces, blobs };
};
const bornRepository = Effect.fnUntraced(function* (git: Git['Service'], files: FileSystem.FileSystem, paths: Path.Path, home: string) {
  const root = paths.join(home, 'checkout');
  yield* files.makeDirectory(root, { recursive: true });
  yield* run(git, root, ['init', '-q', '-b', 'main']);
  yield* run(git, root, ['config', 'user.email', 'git@test']);
  yield* run(git, root, ['config', 'user.name', 'git']);
  yield* run(git, root, ['config', 'maintenance.auto', 'false']);
  yield* files.writeFileString(paths.join(root, 'kept.txt'), BORN);
  yield* run(git, root, ['add', 'kept.txt']);
  yield* run(git, root, ['commit', '-q', '-m', 'born']);
  return root;
});

class FileFixtures extends Context.Service<FileFixtures, { readonly template: string; readonly walks: Walks }>()('testing/FileFixtures') {}
const fileFixtures = kind(FileFixtures, (_params: null, home) =>
  Effect.gen(function* () {
    const template = yield* bornRepository(yield* Git, yield* FileSystem.FileSystem, yield* Path.Path, home);
    const walks = yield* Effect.acquireRelease(
      Effect.sync(() => makeWalks({ size: 1, memory: 1 << 26 })),
      (walks) => walks.close,
    );
    return { template, walks };
  }).pipe(Effect.provide(platform)),
);
export const layers = Layer.effect(FileFixtures, shared(fileFixtures, null)).pipe(Layer.provideMerge(platform));

const opened = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const door = counted(yield* Git);
  const git = door.faces;
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'thread-files-' }));
  const root = paths.join(home, 'checkout');
  const { template, walks } = yield* FileFixtures;
  yield* files.copy(template, root, { overwrite: true });
  yield* store.db.insert(project).values({ id: PROJECT, name: 'runlith', repoKey: root, rootPath: root, createdAt: new Date(0) });
  for (const row of [agent(MINE, 'idle', 'reader'), agent(THEIRS), agent(GONE, 'failed', 'gone')]) {
    yield* bornThread(store.db, row);
  }
  for (const threadId of [MINE, THEIRS, GONE]) {
    yield* scopeRecord(store.db, threadId, { projectId: PROJECT, title: threadId, readerOrderAt: new Date(0) });
  }
  const roots = yield* rootRegistry(yield* fileRootStore(store.db, units), files, paths, namespaceId, unreserved);
  const registered = yield* roots.register({ path: root, provenance });
  yield* store.db.insert(projectRoot).values({ projectId: PROJECT, rootId: registered.rootId, origin: 'canonical' });
  const origin: WorkingRoot = {
    environment: { environmentId: EnvironmentId.make('test-host'), kind: 'host', namespaceId, identityWitness: registered.witness },
    root: { namespaceId, path: registered.path },
    witness: registered.witness,
    registration: { rootId: registered.rootId, locationRevision: registered.locationRevision },
    generation: WorkspaceGeneration.make(0),
  };
  const scope = yield* Effect.scope;
  const checkouts = yield* gitCheckoutRows(git, roots, files, scope);
  const holdings = yield* makeJudges({
    folder: (...asked) => walks.fold(...asked),
    walks,
    memory: new FoldMemory(1 << 26),
    metadata: yield* Effect.provideService(makeGitMetadata, Git, git),
  }).pipe(
    Effect.provideService(Git, git),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(GraphDirectory, '.tagma'),
  );
  const held = heldFeed();
  const judged = (change: HeldChange) => Effect.andThen(judgedChange(holdings, change), held.publish(change));
  checkouts.onMark((rootId, paths) => holdings.marked(rootId, paths));
  const checkoutPaths = yield* fixedCheckoutPaths(PROJECT, [{ checkout: registered.rootId, root }]);
  const intake = yield* intakeOf(store, units, git, checkoutPaths, { checkouts, publish: judged, walks });
  const record = yield* changeRecordOf(store, units, checkoutPaths, intake);
  const authorship = authorshipOver(
    {
      store,
      units,
      roots,
      origins: { rootOf: () => Effect.succeed(origin) },
      git,
      files,
      walks,
      holdings,
      graphDirectory: '.tagma',
      commands: quietCommands,
      names: (threadIds) =>
        Effect.succeed(new Map(threadIds.flatMap((id) => (id in NAMES ? [[id, { name: NAMES[id] ?? null }] as const] : [])))),
    },
    checkouts,
  ).service;
  const changes = threadChangesOver(
    holdings,
    held,
    { store, units, git, roots, checkouts, paths: checkoutPaths },
    { described: new Map(), reaching: new Map() },
  );
  return {
    files,
    paths,
    git,
    blobs: door.blobs,
    walks,
    store,
    units,
    root,
    rootId: registered.rootId,
    origin,
    roots,
    checkouts,
    authorship,
    changes,
    holdings,
    intake,
    writer: Effect.fnUntraced(function* (threadId: string, publish: HeldFeed['Service']['publish']) {
      const writing = yield* intakeOf(store, units, git, checkoutPaths, {
        publish: (change) => Effect.andThen(judged(change), publish(change)),
      });
      return (yield* changeRecordOf(store, units, checkoutPaths, writing)).changes({ work: { projectId: PROJECT, threadId } });
    }),
    mine: record.changes({ work: { projectId: PROJECT, threadId: MINE } }),
    theirs: record.changes({ work: { projectId: PROJECT, threadId: THEIRS } }),
    gone: record.changes({ work: { projectId: PROJECT, threadId: GONE } }),
    list: (thread: string = MINE, limit = 30) => changes.read(PROJECT, thread, registered.rootId, limit),
  };
});
export const fixture = Effect.flatMap(Layer.build(storage), (stored) => Effect.provide(opened, stored));
export const entriesOf = (frame: ThreadChangesFrame): readonly ThreadEntry[] =>
  frame.kind === 'whole' ? frame.checkouts.flatMap((checkout) => checkout.entries) : [];
export const only = (
  frame: ThreadChangesFrame,
): Extract<
  ThreadEntry,
  {
    readonly section: 'uncommitted';
  }
> => {
  const entries = entriesOf(frame);
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  if (entry.section !== 'uncommitted') throw new Error(`expected an uncommitted entry, got ${entry.section}`);
  return entry;
};
export const changed = (answer: PathAuthorship) =>
  answer.lines
    .filter((line) => line.kind !== 'context')
    .map((line) => ({ kind: line.kind, text: line.text, author: line.author === null ? null : holderKey(line.author.holder) }));
export const LONG_BORN = `${Array.from({ length: 900 }, (_, at) => `line ${at + 1}`).join('\n')}\n`;
export const LONG_GROWN = LONG_BORN.replace('line 5\n', 'line five\n').replace('line 860\n', 'line eight sixty\n');
export const committed = Effect.fnUntraced(function* (
  world: Effect.Success<typeof fixture>,
  path: string,
  before: string,
  after: string,
  message: string,
) {
  const at = world.paths.join(world.root, path);
  yield* world.files.makeDirectory(world.paths.dirname(at), { recursive: true });
  yield* world.files.writeFileString(at, after);
  yield* edited(world.mine, at, before, after);
  yield* run(world.git, world.root, ['add', '--', path]);
  yield* run(world.git, world.root, ['commit', '-q', '-m', message, '--', path]);
  yield* Effect.orDie(retiredAt(world.store, world.units, world.git, world.root, world.rootId));
  return yield* run(world.git, world.root, ['rev-parse', 'HEAD']);
});
