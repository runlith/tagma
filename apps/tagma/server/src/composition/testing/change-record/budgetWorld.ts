import { Effect, FileSystem, Layer, Path } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import * as BunSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFiles from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { NamespaceId } from '@runlith/files/namespace';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { project } from '../../../projects/store/table.js';
import { projectRoot } from '../../../workspace/store/tables.js';
import { fileRootStore, gitCheckoutRows, rootRegistry } from '../../../workspace/testing/doubles.js';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { chunk } from '@runlith/utils/collection';
import { makeRowIntake } from '../../../change-record/record/intake.js';
import { makeGitMetadata } from '../../../change-record/record/metadata.js';
import { makeHeads } from '../../../change-record/record/heads.js';
import { Lives } from '../../../change-record/record/lives.js';
import { judgedChange, makeJudges } from '../../../change-record/holdings/judges.js';
import { foldMemoryBudget } from '../../../change-record/lines/memory.js';
import { testWalks } from '../../../change-record/testing/walks.js';
import { FoldMemory } from '../../../change-record/lines/memory.js';
import { makeRetirer } from '../../../change-record/retire/driver.js';
import { makeBackground } from '../../../platform/background.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { HeldFeed } from '../../../change-record/contract/service/held.js';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import { CheckoutRows, GraphDirectory } from '../../../workspace/contract/service/checkouts.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import { idleCommands } from '../../../change-record/testing/doubles.js';
import { lineWrites } from '../../lineWrites.js';
import { workspaceChange, workspaceChangeText, workspaceChangeContent } from '../../../change-record/store/tables.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
export const MINE = 'budget-0';
export const PROJECT = 1;
const namespaceId = NamespaceId.make('holdings-budget');
const provenance = { kind: 'adoption', id: 'operator' };
const unreserved = { holding: () => Effect.succeed(new Map()) };
const run = (git: Git['Service'], root: string, args: readonly string[]) => runGit(git, 'budget-fixture', ['-C', root, ...args]);
const host = BunSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFiles.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { readers: 1, durable: false }, pool))),
  ),
);
export const layers = Layer.mergeAll(storage, BunFiles.layer, Path.layer, gitLayer.pipe(Layer.provide(host)));
export const TRACKED = 20000;
export const HELD = 5000;
export const threadIds = [MINE, ...Array.from({ length: 9 }, (_, at) => `budget-${at + 1}`)];
export const pathAt = (at: number): string => `files/f${String(at).padStart(5, '0')}.txt`;
export const baseAt = (at: number): string => `file ${at}\nbase\nend\n`;
export const heldAt = (at: number): string => `file ${at}\nheld\nend\n`;
export const ownerAt = (at: number, primary = 1000): string => (at < primary ? MINE : threadIds[1 + ((at - primary) % 9)]!);
const data = (text: string): string => `data ${Buffer.byteLength(text)}\n${text}\n`;
const changed = (path: string, text: string): string => `M 100644 inline ${path}\n${data(text)}`;
export const budgetWorld = Effect.fnUntraced(function* (
  size: { readonly tracked: number; readonly held: number; readonly primary?: number } = { tracked: TRACKED, held: HELD },
) {
  const files = yield* FileSystem.FileSystem;
  const pathsApi = yield* Path.Path;
  const git = yield* Git;
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const scope = yield* Effect.scope;
  const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'holdings-budget-' }));
  yield* run(git, root, ['init', '-q', '-b', 'main']);
  yield* run(git, root, ['config', 'core.autocrlf', 'false']);
  yield* store.db.insert(project).values({ id: PROJECT, name: 'budgets', repoKey: root, rootPath: root, createdAt: new Date(0) });
  const roots = yield* rootRegistry(yield* fileRootStore(store.db, units), files, pathsApi, namespaceId, unreserved);
  const registered = yield* roots.register({ path: root, provenance });
  yield* store.db.insert(projectRoot).values({ projectId: PROJECT, rootId: registered.rootId, origin: 'canonical' });
  const checkouts = yield* gitCheckoutRows(git, roots, files, scope);
  const world = { files, paths: pathsApi, git, store, units, root, rootId: registered.rootId, roots, checkouts };
  let imported = `commit refs/heads/main\ncommitter budgets <budgets@test> 1 +0000\n${data('budget fixture')}`;
  for (let at = 0; at < size.tracked; at += 1) imported += changed(pathAt(at), baseAt(at));
  const importedAnswer = yield* world.git.run(['-C', world.root, 'fast-import', '--quiet'], { stdin: `${imported}\ndone\n` });
  if (importedAnswer.status !== 0) return yield* Effect.die(importedAnswer.stderr);
  yield* run(world.git, world.root, ['read-tree', 'HEAD']);
  yield* run(world.git, world.root, ['checkout-index', '-a', '-u']);
  const head = yield* run(world.git, world.root, ['rev-parse', 'HEAD']);
  for (const threadId of threadIds) {
    yield* bornThread(world.store.db, {
      id: threadId,
      status: 'idle',
      ownerId: 'owner',
      agentId: 'tagma',
      spawnRootId: threadId,
      cacheGroup: threadId,
      provider: 'openai-oauth',
      model: 'gpt-test',
      reasoning: 'high',
      authority: { mode: 'trust', bypassFrom: null },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    yield* scopeRecord(world.store.db, threadId, { projectId: PROJECT, title: threadId, readerOrderAt: new Date(0) });
  }
  const paths = Array.from({ length: size.held }, (_, at) => pathAt(at));
  for (const batch of chunk(
    Array.from({ length: size.held }, (_, at) => at),
    200,
  )) {
    yield* world.store.db.insert(workspaceChangeContent).values(
      batch.flatMap((at) =>
        [baseAt(at), heldAt(at)].map((text) => ({
          digest: contentDigest(text),
          text,
          bytes: Buffer.byteLength(text),
          at: new Date(0),
        })),
      ),
    );
    const facts = batch.map((at) => {
      const hunk = workspaceChangeHunk(baseAt(at), heldAt(at))!;
      return {
        id: `budget-row-${at}`,
        projectId: PROJECT,
        holder: ownerAt(at, size.primary),
        checkout: world.rootId,
        path: pathAt(at),
        head,
        state: 'held' as const,
        origin: 'edit' as const,
        mode: '100644',
        at: new Date(at),
        firstLine: hunk.firstLine,
        lines: hunk.newLines,
        oldLines: hunk.oldLines,
        windowBefore: hunk.windowBefore,
        oldText: hunk.oldText,
        newText: hunk.newText,
        beforeHash: contentDigest(baseAt(at)),
        afterHash: contentDigest(heldAt(at)),
      };
    });
    yield* world.store.db.insert(workspaceChange).values(facts.map(({ oldText, newText, ...row }) => row));
    yield* world.store.db.insert(workspaceChangeText).values(facts.map(({ id, oldText, newText }) => ({ row: id, oldText, newText })));
    yield* Effect.forEach(batch, (at) => world.files.writeFileString(world.paths.join(world.root, pathAt(at)), heldAt(at)), {
      concurrency: 3,
      discard: true,
    });
  }
  const checkoutPaths = yield* fixedCheckoutPaths(PROJECT, [{ checkout: world.rootId, root: world.root }]);
  const walks = testWalks;
  const { intake, judges, retirement } = yield* Effect.gen(function* () {
    const metadata = yield* makeGitMetadata;
    const intake = yield* makeRowIntake({ lives: new Lives(), walks, heads: yield* makeHeads, metadata });
    const judges = yield* makeJudges({
      folder: (input, cached, alignment, lane) => walks.fold(input, cached, alignment, lane),
      walks,
      memory: new FoldMemory(foldMemoryBudget()),
      metadata,
    });
    const retirement = yield* makeRetirer({ walks, commands: yield* idleCommands(), background: yield* makeBackground }).pipe(
      Effect.provideService(Holdings, judges),
      Effect.provideService(HeldFeed, { publish: (change) => judgedChange(judges, change), heldChanged: () => () => undefined }),
    );
    return { intake, judges, retirement };
  }).pipe(
    Effect.provideService(FileRoots, roots),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(CheckoutPaths, checkoutPaths),
    Effect.provideService(GraphDirectory, '.tagma'),
    Effect.provideService(LineWrites, lineWrites),
  );
  return { ...world, head, paths, intake, judges, retirement };
});
export const prepareHead = Effect.fnUntraced(function* (world: Effect.Success<ReturnType<typeof budgetWorld>>, count = 200, commits = 50) {
  let imported = '';
  for (let commit = 0; commit < commits; commit += 1) {
    imported += `commit refs/heads/budget-head\ncommitter budgets <budgets@test> ${commit + 2} +0000\n${data(`advance ${commit}`)}`;
    if (commit === 0) imported += `from ${world.head}\n`;
    for (let at = commit; at < count; at += commits) {
      imported += changed(pathAt(at), heldAt(at));
    }
    imported += '\n';
  }
  const answer = yield* world.git.run(['-C', world.root, 'fast-import', '--quiet'], { stdin: `${imported}done\n` });
  if (answer.status !== 0) return yield* Effect.die(answer.stderr);
  const head = yield* run(world.git, world.root, ['rev-parse', 'refs/heads/budget-head']);
  yield* run(world.git, world.root, ['add', '--', ...world.paths.slice(0, count)]);
  return head;
});
