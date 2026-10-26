import type { ThreadRewindMark, ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import type { ChatEntry } from './entries';

export type ChatRewindPoint = {
  readonly rewindable: boolean;
  readonly why?: string;
};

export type ChatRewindWords = {
  rewindHere(): string;
  rewindHint(): string;
  branch(): string;
  branchHint(): string;
  dropTurn(): string;
  dropHint(): string;
  messageActions(): string;
  rewoundTurns(count: number): string;
  unseen(): string;
  dropped(): string;
  wordless(): string;
  show(): string;
  hide(): string;
  restore(): string;
  rewoundTo(ordinal: number): string;
  pickerTitle(): string;
  pickRewind(): string;
  pickBranch(): string;
  pickClose(): string;
  turnFailed(): string;
  turnSteps(count: number): string;
  turnAnswered(): string;
};

export type ChatRewind = {
  readonly words: ChatRewindWords;
  readonly busy: boolean;
  point(runId: string): ChatRewindPoint | undefined;
  restorable(rewindId: string): boolean;
  rewind(runId: string, scope: ThreadRewindScope): Promise<boolean>;
  branch(runId: string): void;
  restore(rewindId: string): void;
};

export type ChatRewindTarget = {
  readonly runId: string;
  readonly entryId: string;
  readonly text: string;
  readonly occurredAt?: string;
  readonly ordinal: number;
  readonly failed: boolean;
  readonly steps: number;
  readonly answered: boolean;
  readonly rewound?: ThreadRewindMark;
};

export type ChatRewindChip = {
  readonly rewindId: string;
  readonly ordinal: number;
};

export function rewindTargets(entries: readonly ChatEntry[]): readonly ChatRewindTarget[] {
  const turns = new Map<
    string,
    { entry: Extract<ChatEntry, { kind: 'user' | 'words' }>; ordinal: number; failed: boolean; steps: number; answered: boolean }
  >();
  let ordinal = 0;
  for (const entry of entries) {
    if (entry.kind === 'user' || (entry.kind === 'words' && entry.opensTurn)) {
      if (entry.runId !== undefined && turns.has(entry.runId)) continue;
      ordinal += 1;
      if (entry.runId !== undefined) turns.set(entry.runId, { entry, ordinal, failed: false, steps: 0, answered: false });
      continue;
    }
    const turn = entry.runId === undefined ? undefined : turns.get(entry.runId);
    if (turn === undefined) continue;
    if (entry.kind === 'error' || (entry.kind === 'run-end' && entry.status === 'failed')) turn.failed = true;
    else if (entry.kind === 'tool') turn.steps += 1;
    else if (entry.kind === 'assistant') turn.answered = true;
  }
  return [...turns.values()].map(({ entry, ordinal, failed, steps, answered }) => ({
    runId: entry.runId as string,
    entryId: entry.id,
    text: entry.text,
    ordinal,
    failed,
    steps,
    answered,
    occurredAt: entry.occurredAt,
    rewound: entry.rewound,
  }));
}

export function trailingFailedTurns(targets: readonly ChatRewindTarget[]): { at: string; count: number } | null {
  let count = 0;
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]!;
    if (target.rewound !== undefined || !target.failed) break;
    count += 1;
  }
  return count === 0 ? null : { at: targets[targets.length - count]!.runId, count };
}

export function rewindChip(targets: readonly ChatRewindTarget[], restorable: (rewindId: string) => boolean): ChatRewindChip | null {
  const seen = new Set<string>();
  for (const target of targets) {
    const mark = target.rewound;
    if (mark === undefined || mark.scope !== 'from' || seen.has(mark.by)) continue;
    seen.add(mark.by);
    if (restorable(mark.by)) return { rewindId: mark.by, ordinal: target.ordinal };
  }
  return null;
}

export type ChatPickerIntent = 'next' | 'previous' | 'rewind' | 'branch' | 'close' | 'none';

export function pickerIntent(press: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}): ChatPickerIntent {
  if (press.isComposing) return 'none';
  if (press.key === 'Escape') return 'close';
  if (press.key === 'Tab') return press.shiftKey ? 'previous' : 'next';
  if (press.metaKey || press.ctrlKey || press.altKey) return 'none';
  switch (press.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Enter':
      return 'rewind';
    case 'b':
    case 'B':
      return 'branch';
    default:
      return 'none';
  }
}
