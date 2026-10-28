import { Cause, Clock, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer } from '../../platform/git/ownGit.js';
import type { UnmergedTracker } from '../../platform/git/unmerged.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { captureTree, commitCapture, treeBranch } from '../tree/batch.js';
import { type CommitJournal, landedAt, messageOf, shapeOf } from '../tree/message.js';
import type { TreeBatches } from '../contract/service/serving.js';
import { refused } from './refusal.js';
import type { PermitHold } from './permits.js';

const RETRY_FIRST_MS = 1_000;
const RETRY_CAP_MS = 300_000;
const MAINTENANCE_EVERY = 100;

export const treeCommitter = ({
  git,
  checkout,
  treeRoot,
  journal,
  unmerged,
  overTree,
  overRepository,
  fork,
  committed,
}: {
  readonly git: Git['Service'];
  readonly checkout: string;
  readonly treeRoot: string;
  readonly journal: CommitJournal;
  readonly unmerged: UnmergedTracker;
  readonly overTree: PermitHold;
  readonly overRepository: PermitHold;
  readonly fork: (effect: Effect.Effect<void>) => unknown;
  readonly committed: () => void;
}): TreeBatches => {
  let pending = new Set<string>();
  let driving = false;
  let failures = 0;
  let published = 0;

  const restore = (paths: Set<string>) => {
    const later = pending;
    pending = paths;
    for (const path of later) paths.add(path);
  };

  const publish = Effect.fn('TreeCommitter.publish', { root: true })(function* (capturing: PermitHold) {
    let paths = new Set<string>();
    return yield* Effect.gen(function* () {
      const branch = yield* refused(treeBranch(treeRoot));
      if (!('ref' in branch)) return 'held' as const;
      yield* refused(journal.recover(landedAt(git, treeRoot)));
      const [capture, words] = yield* capturing(
        Effect.suspend(() => {
          paths = pending;
          pending = new Set();
          return Effect.zip(refused(captureTree(treeRoot, paths, () => false)), refused(journal.words));
        }),
      );
      if (capture.files.size === 0 && capture.gone.size === 0) {
        yield* refused(journal.committed(words.reach));
        return 'published' as const;
      }
      const shape = yield* refused(shapeOf(git, checkout));
      const at = new Date(yield* Clock.currentTimeMillis);
      const made = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* refused(journal.landing(words.reach));
          const commit = yield* refused(
            commitCapture(git, treeRoot, capture, { ref: branch.ref, from: `${branch.ref}^0`, message: messageOf(words, shape), at }),
          );
          yield* refused(journal.committed(words.reach));
          return commit;
        }),
      );
      yield* Effect.annotateCurrentSpan({
        acts: words.lines.length,
        paths: paths.size,
        files: capture.files.size,
        gone: capture.gone.size,
      });
      if (made.unindexed !== null) {
        yield* Effect.logWarning('a tree batch committed but the tree index could not follow it', {
          tree: treeRoot,
          reason: made.unindexed.message,
        });
      } else {
        yield* unmerged.cleanAfterOwnCommit;
      }
      published += 1;
      committed();
      if (published % MAINTENANCE_EVERY === 0) {
        fork(
          Effect.flatMap(Effect.exit(gitAnswer(git, 'batch-maintenance', ['-C', treeRoot, 'gc', '--auto', '--quiet'])), (ended) =>
            ended._tag === 'Success' && ended.value.status === 0
              ? Effect.void
              : Effect.logWarning('git maintenance after tree batches did not run; the next hundred batches ask again', {
                  tree: treeRoot,
                  reason: ended._tag === 'Success' ? ended.value.stderr.trim() : String(ended.cause),
                }),
          ),
        );
      }
      return 'published' as const;
    }).pipe(Effect.onError(() => Effect.sync(() => restore(paths))));
  });

  const drive = () => {
    if (driving) return;
    driving = true;
    fork(
      Effect.gen(function* () {
        while (pending.size > 0) {
          const round = yield* Effect.exit(overRepository(publish(overTree)));
          if (round._tag === 'Success') {
            failures = 0;
            if (round.value === 'held') return;
            continue;
          }
          if (Cause.hasInterrupts(round.cause)) return yield* Effect.interrupt;
          failures += 1;
          const waitMs = Math.min(RETRY_FIRST_MS * 2 ** (failures - 1), RETRY_CAP_MS);
          yield* Effect.logWarning('a tree batch did not commit: its files stand and it commits again', {
            tree: treeRoot,
            failures,
            retryInMs: waitMs,
            cause: round.cause,
          });
          yield* Effect.sleep(waitMs);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            driving = false;
          }),
        ),
      ),
    );
  };

  return {
    carry: (paths) =>
      Effect.sync(() => {
        if (paths.length === 0) return;
        for (const path of paths) pending.add(path);
        drive();
      }),
    flush: Effect.suspend(() => (pending.size === 0 ? Effect.void : Effect.asVoid(publish((work) => work)))),
  };
};
