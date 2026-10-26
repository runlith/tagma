import { basename, dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore, storeDirectory } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { gitAnswer, runGit } from '../../platform/git/ownGit.js';
import { writes } from '../../platform/contract/service/writes.js';
import { relocatedText } from '../../platform/contract/service/relocation.js';
import { TREE_ORIGINS, TREE_SERVED, TREE_MERGES } from '../contract/wire/storage.js';
import { projectPolicy } from '../store/policy.js';
import { meta } from '../store/tables.js';
import { graphHome, legacyHome, MIRROR_FILES, mirrorPath, resolveStorageLayout } from '../storage/layout.js';

const STEP = '20261021123000_storage_stealth';
const marking = writes('GraphSteps.storageStealth', [projectPolicy, meta]);

type StoredProject = { readonly id: number; readonly name: string; readonly rootPath: string; readonly storage: string };

export const storageStealth = Effect.fn('GraphSteps.storageStealth')(
  function* () {
    const store = yield* MachineStore;
    if (store.path === ':memory:') return;
    const marked = yield* store.db.select().from(meta).where(eq(meta.key, STEP)).get();
    if (marked !== undefined) return;
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const appHome = storeDirectory(store.path);
    const move = Effect.fnUntraced(function* (from: string, to: string) {
      if (!(yield* files.exists(from))) return;
      if (yield* files.exists(to))
        return yield* new GateRefusal('graph-pool', `${from} cannot migrate into occupied ${to}`, [
          'keep both copies and restore the intended graph at the source before retrying the update',
        ]);
      yield* files.makeDirectory(dirname(to), { recursive: true });
      yield* files.rename(from, to);
    });
    const moveMirror = Effect.fnUntraced(function* (name: string, from: string, to: string) {
      for (const ending of MIRROR_FILES)
        yield* move(`${mirrorPath(appHome, name, from)}${ending}`, `${mirrorPath(appHome, name, to)}${ending}`);
    });
    const linkLegacy = Effect.fn('GraphSteps.storageGit')(function* (treeRoot: string, gitDir: string) {
      const marker = join(treeRoot, '.git');
      const staging = `${treeRoot}.linking`;
      if (yield* files.exists(marker)) {
        const info = yield* files.stat(marker);
        if (info.type !== 'Directory') {
          yield* runGit(git, 'migrate-storage-linked', ['--git-dir', gitDir, 'worktree', 'repair', treeRoot]);
          yield* files.remove(staging, { recursive: true, force: true });
          return;
        }
        yield* move(marker, gitDir);
      }
      if (!(yield* files.exists(gitDir))) return;
      yield* runGit(git, 'migrate-storage-bare', ['--git-dir', gitDir, 'config', 'core.bare', 'true']);
      const unset = yield* gitAnswer(git, 'migrate-storage-worktree', ['--git-dir', gitDir, 'config', '--unset-all', 'core.worktree']);
      if (unset.status !== 0 && unset.status !== 5)
        return yield* new GateRefusal('graph-pool', unset.stderr || unset.stdout, [
          'repair the legacy Git configuration, then retry the update',
        ]);
      if (!(yield* files.exists(join(staging, '.git'))))
        yield* runGit(git, 'migrate-storage-link', ['--git-dir', gitDir, 'worktree', 'add', '--detach', staging, 'HEAD']);
      const common = yield* files.realPath(gitDir);
      const names = [...(yield* files.readDirectory(gitDir)), 'logs/HEAD', 'info/sparse-checkout'];
      for (const name of names) {
        const from = join(gitDir, name);
        if (!(yield* files.exists(from))) continue;
        const to = yield* runGit(git, 'migrate-storage-git-path', [
          '-C',
          staging,
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          name,
        ]);
        if (to === join(common, name)) continue;
        yield* files.makeDirectory(dirname(to), { recursive: true });
        if (name === 'HEAD') yield* files.copy(from, to, { overwrite: true });
        else {
          yield* files.remove(to, { recursive: true, force: true });
          yield* files.rename(from, to);
        }
      }
      yield* files.rename(join(staging, '.git'), marker);
      yield* runGit(git, 'migrate-storage-linked', ['--git-dir', gitDir, 'worktree', 'repair', treeRoot]);
      yield* files.remove(staging, { recursive: true, force: true });
    });
    const rows = yield* store.db.all<StoredProject>(sql`select p.id, p.name, p.root_path as rootPath,
    coalesce(g.storage, 'stealth') as storage from project p left join project_policy g on g.project_id = p.id`);
    for (const row of rows) {
      if (row.storage !== 'plain' && row.storage !== 'stealth') continue;
      const home = graphHome(appHome, row.name);
      const layout = yield* resolveStorageLayout({ mode: 'stealth', projectName: row.name, appHome, worktree: row.rootPath });
      if (layout.mode !== 'stealth') return yield* Effect.die('stealth storage returned another layout');
      if (row.storage === 'plain') {
        const source = join(legacyHome(appHome), row.name);
        yield* move(source, layout.treeRoot);
        yield* linkLegacy(layout.treeRoot, layout.gitDir);
        yield* moveMirror(row.name, source, layout.treeRoot);
        yield* store.transaction(marking, () =>
          store.db.update(projectPolicy).set({ storage: 'stealth' }).where(eq(projectPolicy.projectId, row.id)),
        );
        continue;
      }
      const former = join(appHome, row.name);
      const formerTrees = join(former, 'trees');
      const oldGit = join(former, 'graph.git');
      if (!(yield* files.exists(oldGit)) && !(yield* files.exists(layout.gitDir))) continue;
      yield* move(oldGit, layout.gitDir);
      yield* move(formerTrees, join(home, 'trees'));
      const formerRecovery = join(former, 'recovery');
      const recovery = join(home, 'recovery');
      yield* move(formerRecovery, recovery);
      const roots = (yield* files.exists(join(home, 'trees')))
        ? (yield* files.readDirectory(join(home, 'trees'))).map((name) => join(home, 'trees', name))
        : [];
      if (roots.length > 0) {
        const places = [
          { from: oldGit, to: layout.gitDir },
          { from: formerTrees, to: join(home, 'trees') },
          { from: formerRecovery, to: recovery },
        ];
        const rewrite = Effect.fnUntraced(function* (path: string) {
          if (!(yield* files.exists(path))) return;
          const before = yield* files.readFileString(path);
          const after = relocatedText(before, places);
          if (after !== before) yield* files.writeFileString(path, after);
        });
        for (const root of roots) {
          const before = join(formerTrees, basename(root));
          for (const kind of [TREE_ORIGINS, TREE_SERVED, TREE_MERGES]) {
            const ending = kind === TREE_MERGES ? '.json' : '';
            const oldRecord = join(layout.gitDir, kind, `${Bun.hash(before).toString(16)}${ending}`);
            const newRecord = join(layout.gitDir, kind, `${Bun.hash(root).toString(16)}${ending}`);
            yield* rewrite(oldRecord);
            yield* move(oldRecord, newRecord);
          }
          yield* rewrite(join(root, '.git'));
          yield* moveMirror(row.name, before, root);
        }
        const recoveries = (yield* files.exists(recovery))
          ? (yield* files.readDirectory(recovery)).map((name) => join(recovery, name))
          : [];
        for (const root of recoveries) yield* rewrite(join(root, '.git'));
        const linked = join(layout.gitDir, 'worktrees');
        if (yield* files.exists(linked))
          for (const name of yield* files.readDirectory(linked)) yield* rewrite(join(linked, name, 'gitdir'));
        yield* rewrite(join(layout.gitDir, 'config'));
        yield* runGit(git, 'migrate-storage-repair', ['--git-dir', layout.gitDir, 'worktree', 'repair', ...roots, ...recoveries]);
      }
    }
    yield* store.transaction(marking, () => store.db.insert(meta).values({ key: STEP, value: 'done' }));
  },
  (effect) =>
    effect.pipe(
      Effect.mapError((failure) =>
        failure instanceof GateRefusal
          ? failure
          : new GateRefusal('graph-pool', `the graph storage step could not finish: ${failure.message}`, [
              'correct the reported storage failure, then retry the update',
            ]),
      ),
      Effect.uninterruptible,
    ),
);
