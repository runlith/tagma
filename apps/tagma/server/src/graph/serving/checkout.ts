import { Effect, FileSystem } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { runGit } from '../../platform/git/ownGit.js';
import { GateRefusal, type GitRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { keyHolds } from '../../projects/identity.js';
import type { ProjectRow, StorageMode } from '../../projects/contract/wire/project.js';
import { Git } from '@runlith/git/Git';
import { type GitWorktree, checkoutAt, checkoutsOf } from '../../workspace/checkouts/git.js';
import { MirrorBuilder, ProjectPolicy, ServingSwitch } from '../contract/service/serving.js';
import type { ProjectBranch } from '../contract/wire/rows.js';
import { layerAt, resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { moveStorage, treeContent } from '../storage/move.js';
import { refusal, refused } from './refusal.js';
import { canon } from '../tree/shadow.js';
import { treeBranch } from '../tree/batch.js';
import type { GitCheckout } from '../../workspace/contract/service/checkouts.js';

export const ownsCheckout = (project: ProjectRow, checkout: GitCheckout): Effect.Effect<boolean, GateRefusal<GitRefusal>> =>
  Effect.flatMap(canon(project.rootPath), (root) =>
    checkout.mainWorktree === root
      ? Effect.succeed(true)
      : Effect.mapError(keyHolds(project, { repoKey: checkout.key, rootPath: checkout.mainWorktree, gitDir: checkout.gitDir }), gitRefusal),
  );

const checkoutOf = Effect.fnUntraced(function* (
  git: Git['Service'],
  row: ProjectPolicyRow,
  cwd: string,
): Effect.fn.Return<string, GateRefusal<GitRefusal>> {
  const here = yield* Effect.mapError(checkoutAt(git, cwd), gitRefusal);
  if (here === null || here.toplevel === here.mainWorktree) return row.rootPath;
  return (yield* ownsCheckout(row, here)) ? here.toplevel : row.rootPath;
});

export const makeServingSwitch = Effect.gen(function* () {
  const git = yield* Git;
  const builder = yield* MirrorBuilder;
  const projects = yield* Projects;
  const policy = yield* ProjectPolicy;
  const machineStore = yield* MachineStore;
  const files = yield* FileSystem.FileSystem;

  const policyOf = Effect.fnUntraced(function* (projectId: number, known?: ProjectRow) {
    const registered = known?.id === projectId ? known : yield* projects.byId(projectId);
    const row = (yield* policy.read([registered.id])).get(registered.id);
    if (row === undefined)
      return yield* new GateRefusal('not-found', `project ${projectId} is not in this store's registry`, [
        'read the project registry again',
      ]);
    return row;
  });

  const standingCheckouts = (row: ProjectPolicyRow): Effect.Effect<readonly GitWorktree[], GateRefusal<'graph-pool'>> =>
    refused(Effect.map(checkoutsOf(git, row.rootPath), (checkouts) => checkouts.filter((worktree) => worktree.branch !== null)));

  const checkoutFor = Effect.fnUntraced(function* (row: ProjectPolicyRow, input: { cwd?: string; branch?: string }) {
    if (input.branch === undefined) {
      return input.cwd === undefined || input.cwd === row.rootPath ? row.rootPath : yield* checkoutOf(git, row, input.cwd);
    }
    const standing = (yield* standingCheckouts(row)).find((worktree) => worktree.branch === input.branch);
    if (standing !== undefined) return standing.path;
    return yield* new GateRefusal('no-checkout', `no working copy stands on branch "${input.branch}"`, [
      `git worktree add <path> ${input.branch} — a branch's graph is read in the checkout that stands on it`,
      'aim at a branch a working copy stands on',
    ]);
  });

  return ServingSwitch.of({
    servedBy: Effect.fnUntraced(function* (input) {
      const row = yield* Effect.catch(policyOf(input.projectId, input.project), (failure) =>
        Effect.fail(
          failure instanceof GateRefusal
            ? new GateRefusal('unknown-project', `no project answers to ${input.projectId}`, [
                'tagma project list — the projects this machine serves',
              ])
            : refusal(failure),
        ),
      );
      const checkout = yield* checkoutFor(row, input);
      const branch = yield* refused(treeBranch(checkout, { operations: false }));
      const readOnly = 'held' in branch && branch.held === 'detached' ? { checkout, main: row.rootPath } : undefined;
      if (readOnly !== undefined && row.storage === 'stealth') {
        const layout = yield* refused(
          resolveStorageLayout({
            mode: row.storage,
            projectId: row.id,
            ...storageHomes(machineStore.path),
            worktree: checkout,
          }),
        );
        if (!(yield* refused(files.exists(layout.treeRoot)))) return { row, checkout: row.rootPath, readOnly };
      }
      return { row, checkout, readOnly };
    }),
    branches: Effect.fnUntraced(function* (projectId) {
      const row = yield* refused(policyOf(projectId));
      const layout = yield* refused(
        resolveStorageLayout({
          mode: row.storage,
          projectId: row.id,
          ...storageHomes(machineStore.path),
          worktree: row.rootPath,
        }),
      );
      const checkouts = yield* standingCheckouts(row);
      const canonical = yield* canon(row.rootPath);
      const rows: ProjectBranch[] = checkouts.map((worktree) => ({
        branch: worktree.branch as string,
        worktree: worktree.path,
        canonical: worktree.path === canonical,
      }));
      const standing = new Set(rows.map((entry) => entry.branch));
      if (rows.length === 0) return [];
      if (layout.mode !== 'team') {
        const twins = yield* refused(
          runGit(git, 'twins', ['--git-dir', layout.gitDir, 'for-each-ref', 'refs/heads', '--format=%(refname:short)']),
        );
        for (const branch of twins === '' ? [] : twins.split('\n')) {
          if (!standing.has(branch)) rows.push({ branch, worktree: null, canonical: false });
        }
      }
      return rows.sort((a, b) => Number(b.canonical) - Number(a.canonical) || a.branch.localeCompare(b.branch));
    }),
    move: Effect.fnUntraced(
      function* (input, bindings) {
        const row = yield* refused(policyOf(input.projectId));
        if (row.storage === input.mode) {
          return yield* new GateRefusal('storage-unchanged', `"${row.name}" already stores its graph as ${input.mode}`, [
            'name the mode it is moving TO',
            'tagma project list — what each project is configured to be',
          ]);
        }
        const homes = storageHomes(machineStore.path);
        const layoutOf = (mode: StorageMode, worktree: string) =>
          refused(resolveStorageLayout({ mode, projectId: row.id, ...homes, worktree }));
        const layerOf = (worktree: string) => layerAt({ projectId: row.id, ...homes, worktree });
        const keep = input.keep ?? [];
        if (keep.length > 0 && input.mode !== 'team') {
          return yield* new GateRefusal('storage-keep', 'subtrees stay stealth only when a stealth graph moves to team', [
            'drop keep — a move to stealth takes every block into the stealth tree',
          ]);
        }
        const from = yield* layoutOf(row.storage, row.rootPath);
        const to = yield* layoutOf(input.mode, row.rootPath);
        const layer = layerOf(row.rootPath);
        const canonical = yield* canon(row.rootPath);
        for (const other of yield* standingCheckouts(row)) {
          if (other.path === canonical) continue;
          const trees = [(yield* layoutOf(row.storage, other.path)).treeRoot];
          if (row.storage === 'team') trees.push(layerOf(other.path).treeRoot);
          for (const tree of trees) {
            if ((yield* refused(treeContent(tree))).length === 0) continue;
            return yield* new GateRefusal('checkout-holds-tree', `${other.path} holds its own tree at ${tree}`, [
              `merge branch "${other.branch}" into the canonical checkout, then drop that tree`,
              'move the project once every checkout but the canonical one is empty',
            ]);
          }
        }
        const kept = keep.length === 0 ? new Set<string>() : yield* bindings.kept(row.id, keep);
        yield* bindings.releaseProject(row.id);
        const reshaped = yield* refused(
          moveStorage({ git, from, to, checkout: row.rootPath, origin: row.graphRemote, layers: { layer, kept } }),
        );
        yield* refused(builder.travelMirror(from.mirrorPath, to.mirrorPath, reshaped ? null : to.treeRoot));
        const moved = yield* refused(policy.setStorage({ id: row.id, mode: input.mode }));
        yield* bindings.releaseProject(row.id);
        yield* bindings.resolveFresh(row.id);
        return { row: moved, treeRoot: to.treeRoot };
      },
      Effect.provideService(FileSystem.FileSystem, files),
    ),
  });
});
