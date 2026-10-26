import { basename, dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore, storeDirectory } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { runGit } from '../../platform/git/ownGit.js';
import { writes } from '../../platform/contract/service/writes.js';
import { type Relocated, relocatedPath, relocatedText } from '../../platform/contract/service/relocation.js';
import { TREE_MERGES, TREE_ORIGINS, TREE_RETIRED, TREE_SERVED } from '../contract/wire/storage.js';
import { meta } from '../store/tables.js';
import { readMirrorIdentities } from '../storage/identity.js';
import { graphHome, graphsHome, MIRROR_FILES, mirrorFile, mirrorHome, mirrorsHome } from '../storage/layout.js';
import { namedStorage } from './namedStorage.js';

const STEP = '20261027000000_storage_by_id';
const marking = writes('GraphSteps.storageById', [meta]);

type StoredProject = { readonly id: number; readonly name: string };

const keyOf = (root: string): string => Bun.hash(root).toString(16);

const distinct = (places: readonly Relocated[]): Relocated[] =>
  places.filter((place, at) => place.from !== place.to && places.findIndex((other) => other.from === place.from) === at);

export const storageById = Effect.fn('GraphSteps.storageById')(
  function* () {
    const store = yield* MachineStore;
    if (store.path === ':memory:') return;
    if ((yield* store.db.select().from(meta).where(eq(meta.key, STEP)).get()) !== undefined) return;
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const appHome = storeDirectory(store.path);
    const rows = (yield* store.db.all<StoredProject>(sql`select id, name from project`)).filter((row) => row.name !== String(row.id));

    const listed = Effect.fnUntraced(function* (directory: string) {
      return (yield* files.exists(directory)) ? yield* files.readDirectory(directory) : [];
    });
    const shift = Effect.fnUntraced(function* (from: string, to: string) {
      if (from === to || !(yield* files.exists(from)) || (yield* files.exists(to))) return;
      yield* files.rename(from, to);
    });
    const relocate = Effect.fnUntraced(function* (path: string, places: readonly Relocated[]) {
      if (!(yield* files.exists(path))) return;
      const before = yield* files.readFileString(path);
      const after = relocatedText(before, places);
      if (after !== before) yield* files.writeFileString(path, after);
    });
    const real = Effect.fnUntraced(function* (path: string) {
      return (yield* files.exists(path)) ? yield* files.realPath(path) : path;
    });
    const occupied = Effect.fnUntraced(function* (path: string) {
      if (!(yield* files.exists(path))) return false;
      return (yield* files.stat(path)).type !== 'Directory' || (yield* files.readDirectory(path)).length > 0;
    });

    let pending = rows.flatMap((row) => {
      const named = namedStorage(appHome, row.name);
      return [
        { from: named.graph, to: graphHome(appHome, row.id) },
        { from: named.mirror, to: mirrorHome(appHome, row.id) },
      ];
    });
    while (pending.length > 0) {
      const blocked: Relocated[] = [];
      for (const move of pending) {
        if (!(yield* files.exists(move.from))) continue;
        if (yield* occupied(move.to)) {
          blocked.push(move);
          continue;
        }
        yield* files.makeDirectory(dirname(move.to), { recursive: true });
        yield* files.rename(move.from, move.to);
      }
      const [first] = blocked;
      if (first !== undefined && blocked.length === pending.length)
        return yield* new GateRefusal('graph-pool', `${first.from} cannot move into occupied ${first.to}`, [
          `keep both copies: move ${first.to} aside, then start the server again`,
        ]);
      pending = blocked;
    }

    const graphs = yield* real(graphsHome(appHome));
    const mirrorRoot = yield* real(mirrorsHome(appHome));
    for (const row of rows) {
      const named = namedStorage(appHome, row.name);
      const graph = graphHome(appHome, row.id);
      const mirrors = mirrorHome(appHome, row.id);
      const realNamed = join(graphs, row.name);
      const realGraph = join(graphs, String(row.id));
      const places = distinct([
        { from: named.graph, to: graph },
        { from: realNamed, to: realGraph },
        { from: named.mirror, to: mirrors },
        { from: join(mirrorRoot, row.name), to: join(mirrorRoot, String(row.id)) },
      ]);
      const mirrorMoved = Effect.fnUntraced(function* (formerRoot: string, root: string) {
        const from = mirrorFile(mirrors, formerRoot);
        const to = mirrorFile(mirrors, root);
        for (const ending of MIRROR_FILES) yield* shift(`${from}${ending}`, `${to}${ending}`);
        const snapshots = `${to}.snapshots`;
        const documents = distinct([{ from: mirrorFile(named.mirror, formerRoot), to }, { from, to }, ...places]);
        yield* relocate(`${to}.snapshot.json`, documents);
        for (const taken of yield* listed(snapshots)) {
          yield* shift(join(snapshots, taken, basename(from)), join(snapshots, taken, basename(to)));
          yield* relocate(join(snapshots, taken, 'manifest.json'), documents);
        }
      });
      const gitDir = join(graph, 'graph.git');
      const roots: string[] = [];
      for (const tree of yield* listed(join(graph, 'trees'))) {
        const root = join(graph, 'trees', tree);
        if ((yield* files.stat(root)).type !== 'Directory') continue;
        yield* mirrorMoved(join(named.graph, 'trees', tree), root);
        for (const [former, current] of distinct([
          { from: join(named.graph, 'trees', tree), to: root },
          { from: join(realNamed, 'trees', tree), to: join(realGraph, 'trees', tree) },
        ]).map((pair) => [pair.from, pair.to] as const)) {
          for (const kind of [TREE_ORIGINS, TREE_SERVED, TREE_MERGES]) {
            const ending = kind === TREE_MERGES ? '.json' : '';
            const record = join(gitDir, kind, `${keyOf(former)}${ending}`);
            yield* relocate(record, places);
            yield* shift(record, join(gitDir, kind, `${keyOf(current)}${ending}`));
          }
        }
        yield* relocate(join(root, '.git'), places);
        roots.push(root);
      }
      for (const record of yield* listed(join(gitDir, TREE_RETIRED))) {
        const path = join(gitDir, TREE_RETIRED, record);
        const former = yield* files.readFileString(path);
        const root = relocatedPath(former, places);
        if (root === null) continue;
        yield* mirrorMoved(former, root);
        const target = join(gitDir, TREE_RETIRED, keyOf(root));
        if (!(yield* files.exists(target))) yield* files.writeFileString(target, root);
        yield* files.remove(path);
      }
      for (const recovery of yield* listed(join(graph, 'recovery'))) {
        const root = join(graph, 'recovery', recovery);
        yield* relocate(join(root, '.git'), places);
        roots.push(root);
      }
      for (const worktree of yield* listed(join(gitDir, 'worktrees')))
        yield* relocate(join(gitDir, 'worktrees', worktree, 'gitdir'), places);
      yield* relocate(join(gitDir, 'config'), places);
      if (roots.length > 0 && (yield* files.exists(gitDir)))
        yield* runGit(git, 'migrate-storage-repair', ['--git-dir', gitDir, 'worktree', 'repair', ...roots]);
      const copies: string[] = [];
      for (const entry of yield* listed(mirrors)) {
        const path = join(mirrors, entry);
        if (entry.endsWith('.sqlite')) copies.push(path);
        if (entry.endsWith('.snapshot.json')) yield* relocate(path, places);
        if (entry.endsWith('.snapshots'))
          for (const taken of yield* listed(path)) yield* relocate(join(path, taken, 'manifest.json'), places);
      }
      if (copies.length === 0) continue;
      const identified = yield* readMirrorIdentities({ baseline: null, paths: copies, relocate: places });
      for (const failure of identified.unread)
        yield* Effect.logWarning('a mirror kept the identity it had under the project name', failure);
    }
    yield* store.transaction(marking, () => store.db.insert(meta).values({ key: STEP, value: 'done' }));
  },
  (effect) =>
    effect.pipe(
      Effect.mapError((failure) =>
        failure instanceof GateRefusal
          ? failure
          : new GateRefusal('graph-pool', `the graph storage could not move to project ids: ${failure.message}`, [
              'correct the reported storage failure, then start the server again',
            ]),
      ),
      Effect.uninterruptible,
    ),
);
