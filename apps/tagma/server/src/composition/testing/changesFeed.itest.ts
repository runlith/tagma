import { retiredAt, retirementOver } from '../../change-record/testing/holdings.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Clock, Effect, FileSystem, Layer, Path, Stream } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { bornThread } from '../../native-harness/testing/born.js';
import { demoGraphLayer, type DemoState, gitEffect, tempRepoEffect, tempRootEffect, withDemo } from './graphFixture.js';
import { threadChangesOver } from '../../change-record/testing/doubles.js';
import { heldFeed } from '../../change-record/record/held.js';
import { placementCoordinator, placementDoubles } from '../../threads/testing/doubles.js';
import { Assignments } from '../../workspace/contract/service/assignments.js';
import { intakeOf } from '../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import {
  assignmentLedger,
  assignmentStore,
  checkoutPaths,
  coveredWorkspace,
  gitCheckoutReads,
  gitCheckoutRows,
} from '../../workspace/testing/doubles.js';
import { lineageOver } from '../../workspace/testing/lineage.js';
import { changesChannel } from '../../change-record/testing/doubles.js';
import { makeWalks } from '../../change-record/lines/walks.js';
import { makeJudges } from '../../change-record/holdings/judges.js';
import { makeGitMetadata } from '../../change-record/record/metadata.js';
import { FoldMemory } from '../../change-record/lines/memory.js';
import { Git } from '@runlith/git/Git';
import { CheckoutRows, GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';

const namespaceId = NamespaceId.make('test-changes-channel');
const THREAD = 'thread-in-tree';

const stand = Effect.fnUntraced(function* (demo: DemoState) {
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const checkout = yield* tempRepoEffect(demo.fixture, 'changes-main-');
  const tree = join(yield* tempRootEffect(demo.fixture, 'changes-tree-'), 'tree');
  yield* gitEffect(checkout, ['worktree', 'add', '-q', '-b', 'side', tree]);
  const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'changes', rootPath: checkout })).id;

  const liveGit = yield* Git;
  const { roots, coverage } = yield* coveredWorkspace({ namespaceId, projects: demo.graph.projects, git: liveGit });
  const scope = yield* Effect.scope;
  const checkouts = yield* gitCheckoutRows(liveGit, roots, files, scope);
  const located = yield* checkoutPaths(coverage, demo.graph.projects);
  const reads = yield* gitCheckoutReads(coverage, located, files, paths, liveGit);
  const covered = yield* coverage.cover(projectId);
  const realTree = yield* files.realPath(tree);
  const locations = yield* Effect.forEach(covered.roots, (root) => Effect.map(files.realPath(root.path), (path) => ({ root, path })));
  const inTree = locations.find((location) => location.path === realTree)?.root;
  const main = covered.roots.find((root) => root.origin === 'canonical');
  if (inTree === undefined || main === undefined) return yield* Effect.die('the coverage holds no worktree or no main checkout');
  expect(inTree.origin).toBe('worktree');

  yield* bornThread(
    db,
    {
      id: THREAD,
      status: 'idle',
      ownerId: 'owner',
      agentId: 'tagma',
      spawnRootId: THREAD,
      cacheGroup: THREAD,
      provider: 'openai-oauth',
      model: 'gpt-test',
      reasoning: 'high',
      authority: { mode: 'trust', bypassFrom: null },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    { projectId, title: THREAD, readerOrderAt: new Date(0) },
  );
  const assignments = yield* assignmentLedger(assignmentStore(db), roots, yield* lineageOver(store, units));
  const place = Effect.fn(function* () {
    const binding = yield* roots.read(inTree.rootId);
    yield* units.write('changesChannel', (unit) =>
      assignments.place(unit, {
        threadId: ThreadId.make(THREAD),
        root: { rootId: binding.rootId, locationRevision: binding.locationRevision },
      }),
    );
  });
  const write = Effect.fn(function* (name: string, text: string) {
    const written = join(tree, name);
    yield* files.writeFileString(written, text);
    const hunk = workspaceChangeHunk('', text);
    yield* (yield* intakeOf(store, units, liveGit, located, { checkouts })).report(
      { projectId, holder: { kind: 'thread', thread: THREAD } },
      [
        {
          origin: 'edit',
          path: written,
          at: new Date(yield* Clock.currentTimeMillis),
          hunk,
          after: contentDigest(text),
          mode: '100644',
        },
      ],
    );
  });

  const walks = yield* Effect.acquireRelease(
    Effect.sync(() => makeWalks()),
    (opened) => opened.close,
  );
  const placement = yield* placementCoordinator().pipe(
    Effect.provideService(MachineUnits, units),
    Effect.provideService(Assignments, assignments),
    Effect.provide(placementDoubles),
  );
  const judges = yield* makeJudges({
    folder: (...asked) => walks.fold(...asked),
    walks,
    memory: new FoldMemory(1 << 24),
    metadata: yield* Effect.provideService(makeGitMetadata, Git, liveGit),
  }).pipe(
    Effect.provideService(Git, liveGit),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(GraphDirectory, CHECKOUT_DIRECTORY),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => checkouts.onMark((rootId, paths) => judges.marked(rootId, paths))),
    (detach) => Effect.sync(detach),
  );
  const changes = threadChangesOver(
    judges,
    heldFeed(),
    { store, units, git: liveGit, roots, checkouts, paths: located },
    { described: new Map(), reaching: new Map() },
  );
  const channel = changesChannel(reads, judges, changes, { rootOf: placement.rootOf });
  const read = Effect.map(channel['thread.changes']({ projectId, threadId: THREAD }).pipe(Stream.runHead), (first) =>
    first._tag === 'Some' && first.value.kind === 'whole' ? first.value : null,
  );
  return { store, units, checkout, tree, inTree, main, roots, checkouts, judges, place, write, read };
});

layer(Layer.mergeAll(demoGraphLayer(), BunFileSystem.layer, Path.layer), { excludeTestServices: true })('checkout change feeds', (it) => {
  it.effect("a thread standing in a worktree reads what it wrote there as its own changes, not main's", () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const s = yield* stand(demo);
        yield* s.place();
        yield* s.write('DEMO.md', 'demo\n');

        yield* s.judges.settled(s.inTree.rootId);
        const frame = yield* s.read;
        expect(frame?.checkouts.map((one) => one.checkout)).toEqual([s.inTree.rootId]);
        expect(frame?.checkouts.flatMap((one) => one.entries.map((entry) => entry.path))).toEqual(['DEMO.md']);

        yield* gitEffect(s.tree, ['add', 'DEMO.md']);
        yield* gitEffect(s.tree, ['commit', '-q', '-m', 'demo in the tree']);
        yield* Effect.orDie(retiredAt(s.store, s.units, yield* Git, s.tree, s.inTree.rootId));
        yield* s.checkouts.refresh(s.inTree.rootId);
        yield* s.judges.settled(s.inTree.rootId);
        const committed = yield* s.read;
        expect(committed?.commits.map((commit) => commit.subject)).toEqual(['demo in the tree']);
        expect(committed?.checkouts.flatMap((one) => one.entries)).toEqual([]);
      }),
    ),
  );

  it.effect('a submodule file event leaves the parent worktree change feed current and its held lines intact', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const s = yield* stand(demo);
        const files = yield* FileSystem.FileSystem;
        yield* gitEffect(s.tree, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', s.checkout, 'nested']);
        yield* gitEffect(s.tree, ['commit', '-qam', 'add nested checkout']);
        yield* s.place();
        yield* s.write('own.txt', 'held\n');
        yield* s.judges.settled(s.inTree.rootId);
        expect((yield* s.read)?.checkouts[0]?.state.kind).toBe('current');

        const generated = 'nested/node_modules/.vite-temp/config.js';
        yield* files.makeDirectory(join(s.tree, 'nested/node_modules/.vite-temp'), { recursive: true });
        yield* files.writeFileString(join(s.tree, generated), 'generated\n');
        yield* s.checkouts.mark(s.inTree.rootId, 'observer', [generated]);
        yield* s.judges.settled(s.inTree.rootId);

        const frame = yield* s.read;
        expect(frame?.checkouts[0]?.state).toEqual({ kind: 'current' });
        expect(frame?.checkouts[0]?.entries).toMatchObject([{ section: 'uncommitted', path: 'own.txt', lines: { added: 1, removed: 0 } }]);
        const judged = yield* s.judges.read(s.inTree.rootId);
        expect(judged.paths.some((one) => one.path === generated)).toBe(false);

        yield* s.write('nested/owned.txt', 'nested held\n');
        yield* s.judges.settled(s.inTree.rootId);
        const recorded = yield* s.read;
        expect(recorded?.checkouts[0]?.state).toEqual({ kind: 'current' });
        expect(recorded?.checkouts[0]?.entries).toMatchObject([
          { section: 'uncommitted', path: 'own.txt', lines: { added: 1, removed: 0 } },
          { section: 'outside', path: 'nested/owned.txt', lines: { added: 1, removed: 0 } },
        ]);
      }),
    ),
  );

  it.effect('a worktree git removed leaves the thread its other checkouts and lets its lines go as checkout-gone', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const s = yield* stand(demo);
        yield* s.write('DEMO.md', 'demo\n');
        yield* gitEffect(s.checkout, ['worktree', 'remove', '--force', s.tree]);

        const vanished = yield* s.read;
        expect(vanished?.checkouts.map((one) => [one.checkout, one.state.kind === 'stale'])).toEqual([
          [s.main.rootId, false],
          [s.inTree.rootId, true],
        ]);

        yield* (yield* retirementOver(s.store, s.units, yield* Git, s.roots, s.checkouts)).pass(s.inTree.rootId);

        const left = yield* s.read;
        expect(left?.checkouts.map((one) => one.checkout)).toEqual([s.main.rootId]);
        expect(left?.ends).toEqual([{ reason: 'checkout-gone', paths: 1 }]);
      }),
    ),
  );

  it.effect('a removed worktree where the thread only committed is absent from the first frame', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const s = yield* stand(demo);
        yield* s.write('DEMO.md', 'demo\n');
        yield* gitEffect(s.tree, ['add', 'DEMO.md']);
        yield* gitEffect(s.tree, ['commit', '-q', '-m', 'demo in the tree']);
        yield* Effect.orDie(retiredAt(s.store, s.units, yield* Git, s.tree, s.inTree.rootId));
        yield* gitEffect(s.checkout, ['worktree', 'remove', '--force', s.tree]);

        const frame = yield* s.read;
        expect(frame?.checkouts.map((one) => one.checkout)).toEqual([s.main.rootId]);
      }),
    ),
  );
});
