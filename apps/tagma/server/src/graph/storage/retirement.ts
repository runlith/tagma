import { basename, join } from 'node:path';
import { Effect, FileSystem, Layer, Queue } from 'effect';
import { Git } from '@runlith/git/Git';
import { worktreesOf } from '@runlith/git/worktree';
import { registeredCheckoutsOf } from '../../workspace/checkouts/git.js';
import { MachineStore, storeDirectory } from '../../platform/contract/service/store.js';
import { Maintenance } from '../../platform/contract/service/maintenance.js';
import { Capacity } from '../../platform/contract/service/capacity.js';
import { MIRROR_RETIREMENT } from '../contract/service/lanes.js';
import { GraphMigrations } from '../contract/service/source.js';
import { chain } from '../../platform/store/chain.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { gitAnswer, OwnGitFailed } from '../../platform/git/ownGit.js';
import { Mirrors } from '../contract/service/mirrors.js';
import { TREE_RETIRED } from '../contract/wire/storage.js';
import { ServedGraphs } from '../contract/service/serving.js';
import { readMirrorIdentities } from './identity.js';
import { removeMirror } from './layout.js';

export type MirrorRetirement = { readonly baseline: string; readonly projectIds?: ReadonlySet<number> };

export const retireMirrors = Effect.fn('Mirrors.retire')(function* ({ baseline, projectIds }: MirrorRetirement) {
  const store = yield* MachineStore;
  if (store.path === ':memory:') return [];
  const files = yield* FileSystem.FileSystem;
  const projects = yield* Projects;
  const pool = yield* ServedGraphs;
  const git = yield* Git;
  const home = join(storeDirectory(store.path), 'mirror');
  const inspection = yield* readMirrorIdentities({ home, baseline });
  for (const failure of inspection.unread) yield* Effect.logWarning('a mirror could not be identified and stays', failure);
  const listed = yield* projects.list();
  const global = yield* projects.global();
  if (global !== undefined && !listed.some((row) => row.id === global.id)) listed.push(global);
  const registered = new Map(listed.map((row) => [row.id, row]));
  const removed: string[] = [];
  for (const { path, identity } of inspection.copies) {
    if (projectIds !== undefined && !projectIds.has(identity.projectId)) continue;
    if (!registered.has(identity.projectId) || basename(path) !== `${Bun.hash(identity.treeRoot).toString(16)}.sqlite`) continue;
    const gone = Effect.gen(function* () {
      if (yield* files.exists(identity.treeRoot)) return;
      const currentProjects = yield* projects.list();
      const currentGlobal = yield* projects.global();
      if (currentGlobal !== undefined && !currentProjects.some((row) => row.id === currentGlobal.id)) currentProjects.push(currentGlobal);
      if (!currentProjects.some((row) => row.id === identity.projectId)) return;
      const { checkout, gitDir, branch } = identity;
      if (identity.mode === 'team') {
        if (yield* files.exists(checkout)) return;
        for (const project of currentProjects) {
          if (!(yield* files.exists(join(project.rootPath, '.git')))) continue;
          if ((yield* registeredCheckoutsOf(git, project.rootPath)).some((tree) => tree.path === checkout)) return;
        }
      } else {
        if (gitDir === null || !(yield* files.exists(join(gitDir, TREE_RETIRED, Bun.hash(identity.treeRoot).toString(16))))) return;
        if ((yield* worktreesOf(git, gitDir)).some((tree) => tree.path === identity.treeRoot)) return;
      }
      if (gitDir !== null && branch !== null) {
        const answer = yield* gitAnswer(git, 'mirror-branch', [
          '--git-dir',
          gitDir,
          'show-ref',
          '--verify',
          '--quiet',
          `refs/heads/${branch}`,
        ]);
        if (answer.status === 0) return;
        if (answer.status !== 1)
          return yield* new OwnGitFailed({ op: 'mirror-branch', message: answer.stderr || answer.stdout, ran: true });
      }
      if (yield* files.exists(identity.treeRoot)) return;
      const current = yield* readMirrorIdentities({ path, baseline });
      for (const failure of current.unread) yield* Effect.logWarning('a mirror could not be identified again and stays', failure);
      if (JSON.stringify(current.copies[0]?.identity) !== JSON.stringify(identity)) return;
      yield* removeMirror(path);
      removed.push(path);
    });
    yield* pool
      .whileClosed({ treeRoot: identity.treeRoot, mirrorPath: path }, gone)
      .pipe(
        Effect.catchTag(
          [
            'PlatformError',
            'SnapshotFailed',
            'OwnGitFailed',
            'GitUnreadable',
            'GitRefused',
            'GitAnswerInvalid',
            'SqlError',
            'EffectDrizzleQueryError',
          ],
          (failure) => Effect.logWarning('mirror retirement did not finish', { path, reason: String(failure) }),
        ),
      );
  }
  return removed;
});

const makeMirrors = Effect.gen(function* () {
  const requests = yield* Queue.sliding<void>(1);
  const pending = new Set<number>();
  const request = (projectId: number): void => {
    pending.add(projectId);
    Queue.offerUnsafe(requests, undefined);
  };
  yield* Effect.addFinalizer(() => Queue.shutdown(requests));
  return Mirrors.of({
    departed: (projectId) => Effect.sync(() => request(projectId)),
    serve: Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Effect.context<MachineStore | FileSystem.FileSystem | Projects | ServedGraphs | Git>();
        const maintenance = yield* Maintenance;
        const capacity = yield* Capacity;
        const baseline = chain(yield* GraphMigrations)[0]!.name;
        const copies = yield* ServedGraphs;
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            copies.copies.subscribe((event) => {
              if (event.kind === 'closed') request(event.projectId);
            }),
          ),
          (release) => Effect.sync(release),
        );
        const pass = (projectIds?: ReadonlySet<number>) =>
          capacity
            .ticket(MIRROR_RETIREMENT, retireMirrors({ baseline, projectIds }).pipe(Effect.provide(context)))
            .pipe(
              Effect.catchTag(['CapacityBusy', 'HoldStalled', 'SnapshotFailed', 'SqlError', 'EffectDrizzleQueryError'], (failure) =>
                Effect.logWarning('the mirror retirement pass did not finish', { reason: String(failure) }),
              ),
            );
        yield* maintenance.opened;
        yield* pass();
        for (;;) {
          yield* Queue.take(requests);
          const projects = new Set(pending);
          pending.clear();
          yield* pass(projects);
        }
      }),
    ),
  });
});

export const mirrorsLayer = Layer.effect(Mirrors, makeMirrors);

export const mirrorRetirementLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const mirrors = yield* Mirrors;
    yield* Effect.forkScoped(mirrors.serve);
  }),
);
