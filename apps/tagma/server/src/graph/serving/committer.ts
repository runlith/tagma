import { Cause, Clock, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer } from '../../platform/git/ownGit.js';
import type { UnmergedTracker } from '../../platform/git/unmerged.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { captureTree, commitCapture, treeBranch } from '../tree/batch.js';
import type { TreeBatches } from '../contract/service/serving.js';
import { refused } from './refusal.js';
import type { PermitHold } from './permits.js';

const NAMED_ACTS = 6;
const RETRY_FIRST_MS = 1_000;
const RETRY_CAP_MS = 300_000;
const MAINTENANCE_EVERY = 100;

type Pending = {
  readonly paths: Set<string>;
  readonly messages: string[];
  readonly authors: Set<string>;
  acts: number;
};

const nothing = (): Pending => ({ paths: new Set(), messages: [], authors: new Set(), acts: 0 });

const messageOf = (batch: Pending): string => {
  const { acts } = batch;
  const subject =
    acts === 0
      ? 'the tree as the graph read it'
      : acts === 1
        ? (batch.messages[0] as string)
        : `${acts} acts: ${batch.messages.join(' · ')}${acts > NAMED_ACTS ? ` +${acts - NAMED_ACTS}` : ''}`;
  return batch.authors.size > 1 ? `${subject}\n\nby ${[...batch.authors].sort().join(', ')}\n` : `${subject}\n`;
};

export const treeCommitter = ({
  git,
  treeRoot,
  unmerged,
  overTree,
  overRepository,
  fork,
  committed,
}: {
  readonly git: Git['Service'];
  readonly treeRoot: string;
  readonly unmerged: UnmergedTracker;
  readonly overTree: PermitHold;
  readonly overRepository: PermitHold;
  readonly fork: (effect: Effect.Effect<void>) => unknown;
  readonly committed: () => void;
}): TreeBatches => {
  let pending = nothing();
  let driving = false;
  let failures = 0;
  let published = 0;

  const take = () => {
    const batch = pending;
    pending = nothing();
    return batch;
  };

  const restore = (batch: Pending) => {
    const later = pending;
    pending = batch;
    for (const path of later.paths) batch.paths.add(path);
    batch.acts += later.acts;
    for (const message of later.messages) if (batch.messages.length < NAMED_ACTS) batch.messages.push(message);
    for (const author of later.authors) if (batch.authors.size <= NAMED_ACTS) batch.authors.add(author);
  };

  const publish = Effect.fn('TreeCommitter.publish', { root: true })(function* (capturing: PermitHold) {
    let batch = nothing();
    return yield* Effect.gen(function* () {
      const branch = yield* refused(treeBranch(treeRoot));
      if (!('ref' in branch)) return 'held' as const;
      const capture = yield* capturing(
        Effect.suspend(() => {
          batch = take();
          return refused(captureTree(treeRoot, batch.paths, () => false));
        }),
      );
      if (capture.files.size === 0 && capture.gone.size === 0) return 'published' as const;
      const made = yield* Effect.uninterruptible(
        refused(
          commitCapture(git, treeRoot, capture, {
            ref: branch.ref,
            from: `${branch.ref}^0`,
            message: messageOf(batch),
            author: batch.authors.size === 1 ? ([...batch.authors][0] as string) : 'tagma',
            at: new Date(yield* Clock.currentTimeMillis),
          }),
        ),
      );
      yield* Effect.annotateCurrentSpan({
        acts: batch.messages.length,
        paths: batch.paths.size,
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
    }).pipe(Effect.onError(() => Effect.sync(() => restore(batch))));
  });

  const drive = () => {
    if (driving) return;
    driving = true;
    fork(
      Effect.gen(function* () {
        while (pending.paths.size > 0) {
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
    land: (landed) =>
      Effect.sync(() => {
        if (landed.paths.length === 0) return;
        for (const path of landed.paths) pending.paths.add(path);
        pending.acts += 1;
        if (pending.messages.length < NAMED_ACTS) pending.messages.push(landed.message);
        if (pending.authors.size <= NAMED_ACTS) pending.authors.add(landed.author);
        drive();
      }),
    carry: (paths) =>
      Effect.sync(() => {
        if (paths.length === 0) return;
        for (const path of paths) pending.paths.add(path);
        drive();
      }),
    flush: Effect.suspend(() => (pending.paths.size === 0 ? Effect.void : Effect.asVoid(publish((work) => work)))),
  };
};
