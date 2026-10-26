import { Effect } from 'effect';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import type { MergeMode } from '../../worktrees/contract/wire/mergeTypes.js';
import { type FinishFailure, WorktreeFinishRefused } from '../../worktrees/contract/wire/failures.js';
import type { WorktreeRecord } from '../../worktrees/contract/service/worktrees.js';
import { refused } from '../../worktrees/retirement/finishing.js';
import { MergeGit, type MergeHookRefused, type MergePrepared } from '../contract/service/mergeGit.js';
import { MERGE_TRAILER } from '../contract/wire/merge.js';
import { conflicting } from './failures.js';
import type { Sent, Settled } from './publication.js';

export type MergeCut = {
  readonly mode: MergeMode;
  readonly branch: string;
  readonly baseBranch: string;
  readonly tip: string;
  readonly baseTip: string;
  readonly tree: string;
  readonly dir: string;
  readonly message: string | undefined;
};

export type Publishing = (commit: string) => Effect.Effect<Sent, FinishFailure | HoldStalled | HoldCut>;

export type Landed =
  | { readonly _tag: 'moved' }
  | {
      readonly _tag: 'landed';
      readonly key: string;
      readonly base: string;
      readonly branch: string;
      readonly settled: Settled;
      readonly unrecorded: string | null;
    };

const MOVED: Landed = { _tag: 'moved' };

const trailed = (record: WorktreeRecord, at: MergeCut, said: string): string =>
  `${at.message ?? said}\n\n${MERGE_TRAILER}: ${record.rootId}`;

export const makeMergeCommits = Effect.fnUntraced(function* () {
  const git = yield* MergeGit;
  const hooks = Effect.fnUntraced(function* (
    record: WorktreeRecord,
    at: MergeCut,
  ): Effect.fn.Return<MergePrepared, FinishFailure | MergeHookRefused | HoldStalled | HoldCut> {
    if (at.mode !== 'merge') {
      return { tree: at.tree, left: at.tree, message: '', sign: yield* git.signing(at.dir) };
    }
    const message = trailed(record, at, `Merge worktree ${record.name} (${at.branch}) into ${at.baseBranch}`);
    return yield* git.hooks(at.dir, at.baseTip, at.tree, message);
  });
  const land = Effect.fnUntraced(function* (
    record: WorktreeRecord,
    at: MergeCut,
    made: MergePrepared,
    publishing: Publishing,
  ): Effect.fn.Return<Landed, FinishFailure | HoldStalled | HoldCut> {
    const landed = Effect.fnUntraced(function* (
      base: string,
      branch: string,
    ): Effect.fn.Return<Landed, FinishFailure | HoldStalled | HoldCut> {
      const sent = yield* publishing(base);
      if (sent._tag === 'moved') return MOVED;
      if (sent.settled.reason === null) yield* git.posted(at.dir, base);
      return { _tag: 'landed', key: sent.key, base, branch, settled: sent.settled, unrecorded: sent.unrecorded };
    });
    if (at.mode === 'merge') {
      const merged = yield* git.create(at.dir, { tree: made.tree, parents: [at.baseTip, at.tip], message: made.message, sign: made.sign });
      return yield* landed(merged, at.tip);
    }
    if (at.mode === 'squash') {
      const message = `${trailed(record, at, `${record.name}: ${at.branch} squashed into ${at.baseBranch}`)}\n`;
      const squashed = yield* git.create(at.dir, { tree: at.tree, parents: [at.baseTip], message, sign: made.sign });
      return yield* landed(squashed, at.tip);
    }
    const replaying = git.replay(record.path, at.baseTip, at.tip, made.sign);
    const replayed = yield* made.sign
      ? replaying.pipe(
          Effect.timeoutOrElse({
            duration: CEILINGS.callCap,
            orElse: () =>
              Effect.fail(
                new WorktreeFinishRefused({
                  reason: 'commit-unsigned',
                  message: `the signer did not answer within ${CEILINGS.callCap / 60_000} minutes while the branch was replayed`,
                  unblock: ['answer the signer commit.gpgsign names, then merge again'],
                }),
              ),
          }),
        )
      : replaying;
    if (replayed.head === null) return yield* conflicting(at.baseBranch, replayed.conflicts);
    if (replayed.tree !== at.tree) {
      return yield* refused('rebase-merges', `replaying ${at.branch} onto ${at.baseBranch} lands another tree than merging it would`, [
        'merge it instead (mode merge), or squash it (mode squash)',
      ]);
    }
    return yield* landed(replayed.head, at.tip);
  });
  return { hooks, carry: git.carry, land };
});

export type MergeCommits = Effect.Success<ReturnType<typeof makeMergeCommits>>;
