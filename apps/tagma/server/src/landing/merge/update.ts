import { Effect } from 'effect';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { CheckoutEntry, CheckoutHolder, CheckoutState } from '../../workspace/contract/wire/checkout.js';
import { rowHolders } from '../../workspace/checkouts/holders.js';
import type { WorktreeRecord } from '../../worktrees/contract/service/worktrees.js';
import type { FinishFailure } from '../../worktrees/contract/wire/failures.js';
import { holderName, pathsOf, refused, stored, underGraph } from '../../worktrees/retirement/finishing.js';
import type { MergeGit } from '../contract/service/mergeGit.js';
import { trailed } from '../../platform/contract/wire/commits.js';
import { CO_AUTHOR } from '../land/message.js';

export type Uncommitted = {
  readonly dirty: readonly CheckoutEntry[];
  readonly held: readonly { readonly entry: CheckoutEntry; readonly holder: CheckoutHolder }[];
};

export const uncommittedOn = (
  reading: CheckoutState,
  holders: ReadonlyMap<string, readonly CheckoutHolder[]>,
  areas: readonly (keyof CheckoutState['entries'])[],
  paths: ReadonlySet<string>,
): Uncommitted => {
  const dirty = pathsOf(reading, areas).filter((entry) => paths.has(entry.path));
  const held = dirty.flatMap((entry) =>
    (holders.get(entry.path) ?? []).filter((holder) => !holder.retired).map((holder) => ({ entry, holder })),
  );
  return { dirty, held };
};

export type Taking = {
  readonly record: WorktreeRecord;
  readonly branch: string;
  readonly baseBranch: string;
  readonly tip: string;
  readonly baseTip: string;
  readonly tree: string;
  readonly paths: readonly string[];
  readonly coAuthored: boolean;
};

export const takeBase = (git: MergeGit['Service'], checkouts: CheckoutRows['Service'], holdings: CheckoutHoldings['Service']) =>
  Effect.fn('Merges.takeBase')(function* (at: Taking): Effect.fn.Return<string, FinishFailure | HoldStalled | HoldCut> {
    const { record, branch, baseBranch, tip } = at;
    const reading = yield* checkouts.read(record.rootId);
    const holders = yield* stored(rowHolders(reading, holdings));
    const standing = uncommittedOn(reading, holders, ['staged', 'unstaged', 'untracked'], new Set(at.paths));
    if (standing.held.length > 0) {
      const named = [...new Set(standing.held.map(({ holder }) => holderName(holder)))];
      return yield* refused(
        'source-held',
        `the merge takes ${baseBranch} into ${branch} first, because both changed the graph, and lines on ${[...new Set(standing.held.map(({ entry }) => entry.path))].join(', ')} in the worktree are held by ${named.join(', ')} on paths that writes`,
        [`wait until ${named.join(', ')} commits those lines, then merge`],
      );
    }
    if (standing.dirty.length > 0) {
      const graphOnly = standing.dirty.every((entry) => underGraph(entry.path));
      return yield* refused(
        'source-dirty',
        `the merge takes ${baseBranch} into ${branch} first, because both changed the graph, and the worktree holds uncommitted changes nobody's record claims on paths that writes: ${standing.dirty.map((entry) => entry.path).join(', ')}`,
        [
          graphOnly
            ? 'deliver the graph of the worktree with sync_graph, then merge'
            : 'commit or discard those changes in the worktree, then merge',
        ],
      );
    }
    const message = `${trailed(`Merge ${baseBranch} into ${branch}`, at.coAuthored ? [CO_AUTHOR] : [])}\n`;
    return yield* git.take({ checkout: record.path, branch, baseBranch, tip, baseTip: at.baseTip, tree: at.tree, message });
  });
