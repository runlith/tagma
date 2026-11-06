import type { AfterMerged } from '@tagma/server/landing/contract/wire/merge';
import type { GraphSync } from '@tagma/server/landing/contract/wire/receipt';
import type { WorktreeDeleted } from '@tagma/server/worktrees/contract/wire/retirement';
import type { GraphChanges, GraphKindChanges } from '@tagma/server/graph/contract/wire/branchChanges';
import type { WorktreeActKind, WorktreeActPhase } from '@tagma/server/worktrees/contract/wire/rows';
import type { EndedExecution } from '@tagma/server/executions/contract/wire/rootExecutions';
import { refusalLines } from '@runlith/agent/tool/refusal';

export const ACT_WORDS: Record<WorktreeActKind | 'cancel', string> = {
  delete: 'Deleting',
  merge: 'Merging',
  rename: 'Renaming',
  update: 'Handing the update',
  'pull-request': 'Opening a pull request',
  clean: 'Cleaning up',
  cancel: 'Dropping the merge',
};

export const PHASE_WORDS: Record<WorktreeActPhase, string> = {
  waiting: 'queued',
  ending: 'ending what runs',
  committing: 'committing leftovers',
  removing: 'removing the folder',
  'deleting-branch': 'removing the branch',
  checking: 'checking',
  judging: 'judging rules',
  landing: 'landing',
  syncing: 'syncing the graph',
  'checking-out': 'checking out',
  registering: 'registering',
  pushing: 'pushing',
  opening: 'opening',
  renaming: 'renaming the branch',
};

export function deletedWords(answer: WorktreeDeleted): readonly string[] {
  return [
    'deleted',
    answer.branch.status === 'deleted'
      ? 'branch deleted'
      : answer.branch.commits.length > 0
        ? `branch kept, ${counted(answer.branch.commits.length, 'commit')} ahead`
        : 'branch kept',
  ];
}

export function mergedAfterWords(after: AfterMerged): readonly string[] {
  if (after.refusal !== null) return ['not deleted'];
  if (after.deleted !== null) return deletedWords(after.deleted);
  return [];
}

export const counted = (count: number, tag: string): string => `${count} ${count === 1 ? tag : `${tag}s`}`;

function kindWords(kind: GraphKindChanges): readonly string[] {
  const words: string[] = [];
  if (kind.added > 0) words.push(`${counted(kind.added, kind.tag)} added`);
  if (kind.changed > 0) words.push(`${counted(kind.changed, kind.tag)} changed`);
  if (kind.done > 0) words.push(`${counted(kind.done, kind.tag)} ${kind.doneWord ?? 'done'}`);
  if (kind.closed > 0) words.push(`${counted(kind.closed, kind.tag)} ${kind.closedWord ?? 'closed'}`);
  if (kind.removed > 0) words.push(`${counted(kind.removed, kind.tag)} removed`);
  return words;
}

export function graphChangeWords(graph: GraphChanges | null): string | null {
  if (graph === null) return null;
  if (graph.status === 'unread') return 'not read';
  const words = graph.kinds.flatMap(kindWords);
  if (graph.unsorted > 0) words.push(`${counted(graph.unsorted, 'file')} more`);
  if (graph.unreadable.length > 0) words.push(`${counted(graph.unreadable.length, 'file')} unreadable`);
  return words.length === 0 ? 'no changes' : words.join(', ');
}

export function endedWords(ended: readonly EndedExecution[]): string | null {
  if (ended.length === 0) return null;
  const named = ended.map((one) => one.program ?? one.kind);
  return `Ended ${counted(ended.length, 'execution')} that ran there: ${named.join(', ')}.`;
}

export function graphWords(graph: GraphSync): readonly string[] {
  switch (graph.status) {
    case 'carried':
      return ['The graph lives in the tree, so it merged with the code.'];
    case 'unread':
      return [`The base's graph sync could not be read: ${graph.reason}`];
    case 'synced': {
      const merged =
        graph.merges.length === 0
          ? ['The base graph synced; no branch graph needed merging.']
          : graph.merges.map((merge) =>
              merge.conflicts.length > 0
                ? `Graph of ${merge.branch}: ${merge.conflicts.length} ${merge.conflicts.length === 1 ? 'conflict' : 'conflicts'} — ${merge.conflicts.slice(0, 3).join(', ')}`
                : merge.merged === null
                  ? `Graph of ${merge.branch}: nothing new to merge`
                  : `Graph of ${merge.branch} merged as ${merge.merged.slice(0, 7)}`,
            );
      return [
        ...merged,
        ...(graph.copyFailures ?? []).flatMap((failure) => [
          `Graph copy ${failure.copy.tree} · checkout ${failure.copy.checkout}`,
          ...refusalLines(failure.error),
        ]),
      ];
    }
  }
}
