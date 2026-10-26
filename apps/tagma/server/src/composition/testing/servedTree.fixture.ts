import { join } from 'node:path';
import { Context, Deferred, Effect, Exit, FileSystem, Option } from 'effect';
import { Git } from '@runlith/git/Git';
import type { EffectDemo } from './graphFixture.js';
import { fixtureGraphMigrations } from './migrations.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Selection } from '../../graph/contract/service/reads.js';
import { Catalogs, NO_CATALOGS } from '../../graph/contract/wire/catalogs.js';
import { FORMAT_FILE } from '../../graph/contract/wire/storage.js';
import { storageHomes, resolveStorageLayout } from '../../graph/storage/layout.js';
import { ShadowGit } from '../../graph/tree/shadow.js';
import { markerText } from '../../graph/tree/marker.js';
import { shippedSteps } from '../../graph/steps/sequence.js';
import { writeBlockTree, readBlockTree } from '../../graph/tree/layout.js';
import { graphPool } from '../../graph/testing/doubles.js';

const rootId = '0199bbbb-0000-7000-8000-0000cafe0099';

export const servedTree = Effect.fnUntraced(function* (
  demo: EffectDemo,
  wrap: (inner: FileWatcher['Service']) => FileWatcher['Service'] = (inner) => inner,
) {
  const { graph, context, project, demoRoot } = demo;
  const standing = yield* Effect.serviceOption(FileWatcher);
  if (Option.isNone(standing)) return yield* Effect.die('the fixture runs no watch process');
  const watcher = wrap(standing.value);
  const fs = yield* FileSystem.FileSystem;
  const checkout = project('topology').root;
  const row = yield* graph.projectPolicy.setStorage({ id: project('topology').id, mode: 'stealth' });
  const current = yield* resolveStorageLayout({
    mode: 'stealth',
    projectName: row.name,
    ...storageHomes(graph.store.path),
    worktree: checkout,
  });
  if (current.mode !== 'stealth') return yield* Effect.die('the fixture requires a stealth tree');
  const shadow = yield* ShadowGit.open(current.gitDir, graph.git, null);
  const main = yield* runGit(graph.git, 'test-topology', ['-C', checkout, 'symbolic-ref', '--short', 'HEAD']);
  if (main !== 'main') yield* shadow.branch(main, 'main');
  yield* shadow.attach(current.treeRoot, main);
  yield* shadow.recordCheckout(current.treeRoot, checkout, checkout);
  const root = { parentId: null, frontmatter: { id: rootId, title: 'Topology', ord: 1 }, body: 'Main' };
  yield* writeBlockTree(current.treeRoot, [root]);
  yield* fs.writeFileString(join(current.treeRoot, FORMAT_FILE), markerText(shippedSteps.last));
  yield* shadow.commitAct(current.treeRoot, 'main graph');
  const [file] = yield* readBlockTree(current.treeRoot);
  if (file === undefined) return yield* Effect.die('the fixture wrote no block file');
  const statuses: (readonly string[])[] = [];
  const waiting: { readonly test: (args: readonly string[]) => boolean; readonly done: Deferred.Deferred<void> }[] = [];
  const inner = Context.get(context, Git);
  const recorded: Git['Service'] = {
    ...inner,
    run: (args, options) =>
      Effect.suspend(() => {
        if (args.includes('--porcelain=v2') && args.includes(current.treeRoot)) {
          statuses.push(args);
          for (const one of waiting) if (one.test(args)) Deferred.doneUnsafe(one.done, Exit.void);
        }
        return inner.run(args, options);
      }),
  };
  const pathspec = (args: readonly string[]): string => args.slice(args.indexOf('--') + 1).join(' ');
  const pool = yield* Effect.acquireRelease(
    graphPool({
      machine: Context.add(Context.add(Context.add(context, Catalogs, NO_CATALOGS), Git, recorded), FileWatcher, watcher),
      sourcePath: demoRoot,
      identity: testSessionIdentity,
      migrations: fixtureGraphMigrations,
    }),
    (held) => held.dispose(),
  );
  const settled = pool.freshnessGate.settled(current.treeRoot);
  let served = yield* pool.resolve({ projectId: row.id, cwd: checkout }).pipe(Effect.provideService(FileWatcher, watcher));
  yield* settled;
  return {
    root: current.treeRoot,
    statuses,
    settled,
    release: Effect.suspend(() => pool.release(served)),
    serve: Effect.gen(function* () {
      served = yield* pool.resolve({ projectId: row.id, cwd: checkout }).pipe(Effect.provideService(FileWatcher, watcher));
      yield* settled;
    }),
    scoped: (args: readonly string[]) => pathspec(args) === `:(literal)${file.path}`,
    whole: (args: readonly string[]) => pathspec(args) === '.',
    after: (from: number, test: (args: readonly string[]) => boolean) =>
      Effect.suspend(() => {
        if (statuses.slice(from).some(test)) return Effect.void;
        const done = Deferred.makeUnsafe<void>();
        waiting.push({ test, done });
        return Deferred.await(done);
      }),
    edit: (body: string) => writeBlockTree(current.treeRoot, [{ ...root, body }]),
    bodies: Effect.suspend(() =>
      Effect.map(Context.get(served.context, Selection).roots(row.id), (blocks) => blocks.map((block) => block.body)),
    ),
  };
});
