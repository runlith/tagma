import { existsSync } from 'node:fs';
import { Context, Effect, Exit, FileSystem, type Semaphore } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore, GraphStore } from '../../platform/contract/service/store.js';
import { chain } from '../../platform/store/chain.js';
import { GraphMigrations } from '../contract/service/source.js';
import { ServingSwitch } from '../contract/service/serving.js';
import { TwinFailed, type BranchTwins } from '../contract/service/branchTwins.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { renameColdMirror, renameMirrorBranch } from '../storage/identity.js';
import { ShadowGit } from '../tree/shadow.js';
import type { GraphSide } from '../contract/service/exchange.js';
import type { Copies } from './copies.js';
import { overEntry, overMirror, overRepositoryAndTree } from './permits.js';

type TwinningInput = {
  readonly gate: (key: string) => Semaphore.Semaphore;
  readonly copies: Copies;
  readonly side: (projectId: number) => GraphSide;
};

export const makeTwinning = Effect.fnUntraced(function* ({ gate, copies, side }: TwinningInput) {
  const git = yield* Git;
  const machineStore = yield* MachineStore;
  const servingSwitch = yield* ServingSwitch;
  const files = yield* FileSystem.FileSystem;
  const baseline = chain(yield* GraphMigrations)[0]!.name;
  const followBranch: BranchTwins = Effect.fn('BranchTwins.rename')(function* <A, E>(
    place: Parameters<BranchTwins>[0],
    rename: Effect.Effect<A, E>,
  ) {
    const unfollowed = (failure: { readonly message: string }) => new TwinFailed({ message: failure.message });
    if (machineStore.path === ':memory:') return yield* rename;
    const { row, checkout } = yield* servingSwitch
      .servedBy({ projectId: place.projectId, cwd: place.checkout })
      .pipe(Effect.mapError(unfollowed));
    if (row.storage === 'stealth' && checkout === row.rootPath) {
      return yield* new TwinFailed({
        message: `${place.checkout} is not a checkout of project ${place.projectId} apart from its main one`,
      });
    }
    const layout = yield* resolveStorageLayout({
      mode: row.storage,
      projectId: row.id,
      ...storageHomes(machineStore.path),
      worktree: checkout,
    }).pipe(Effect.mapError(unfollowed));
    return yield* overEntry(
      gate,
      layout.treeRoot,
    )(
      overRepositoryAndTree(
        gate,
        layout,
      )(
        overMirror(
          gate,
          layout.mirrorPath,
        )(
          Effect.gen(function* () {
            const shadow =
              layout.mode === 'stealth' && existsSync(layout.gitDir)
                ? yield* ShadowGit.open(layout.gitDir, git, side(row.id)).pipe(Effect.mapError(unfollowed))
                : null;
            const moved = shadow === null ? false : yield* shadow.renameBranch(place.from, place.to).pipe(Effect.mapError(unfollowed));
            const renamed = yield* Effect.exit(rename);
            if (Exit.isFailure(renamed)) {
              if (moved && shadow !== null)
                yield* shadow.renameBranch(place.to, place.from).pipe(
                  Effect.catchTag('OwnGitFailed', (failure) =>
                    Effect.logWarning('a graph twin renamed ahead of its branch could not be renamed back', {
                      from: place.to,
                      to: place.from,
                      reason: failure.message,
                    }),
                  ),
                );
              return yield* Effect.failCause(renamed.cause);
            }
            const held = copies.at(layout.treeRoot)?.graph;
            yield* (
              held === undefined
                ? renameColdMirror(layout.mirrorPath, baseline, place).pipe(Effect.provideService(FileSystem.FileSystem, files))
                : renameMirrorBranch(place).pipe(Effect.provideService(GraphStore, Context.get(held.context, GraphStore)))
            ).pipe(Effect.mapError(unfollowed));
            return renamed.value;
          }),
        ),
      ),
    );
  });
  return followBranch;
});
