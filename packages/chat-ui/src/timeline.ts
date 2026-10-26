import type { ActivityEntry, ActivityGroup, ActivityRow, RailPlace } from './activity';
import { type ChatEntry, entryKindOf } from './entries';
import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import { FEED_GAP_PX, tailEstimate } from './rowEstimate';

type DayBoundary = { dayBefore?: string };

export type ChatTailSlot = 'ready-answers' | 'notice';

export type ChatLiveWork = {
  readonly runId: string;
  readonly entries: readonly ActivityEntry[];
  readonly status: boolean;
};

type RowShape = {
  estimate: number;
  spaced: boolean;
  keepAlive?: true;
  open?: boolean;
};

export type ChatTimelineItem =
  | ({ kind: 'entry'; key: string; entry: ChatEntry } & DayBoundary & RowShape)
  | ({ kind: 'stretch'; key: string; group: ActivityGroup; thoughts: boolean } & DayBoundary & RowShape)
  | ({
      kind: 'step';
      key: string;
      stretch: string;
      row: ActivityRow;
      place: RailPlace;
      bare: boolean;
      live?: boolean;
    } & DayBoundary &
      RowShape)
  | ({ kind: 'status'; key: string; stretch: string; place: RailPlace } & DayBoundary & RowShape)
  | ({
      kind: 'rewind';
      key: string;
      rewind: string;
      scope: ThreadRewindScope;
      turns: number;
      words: string;
      open: boolean;
      occurredAt?: string;
    } & DayBoundary &
      RowShape)
  | ({ kind: 'tail'; key: string; slot: ChatTailSlot } & RowShape);

export interface RowModel {
  readonly revision: number;
  readonly shape: number;
  readonly count: number;
  keyAt(index: number): string | undefined;
  itemAt(index: number): ChatTimelineItem | undefined;
  item(key: string): ChatTimelineItem | undefined;
  indexOf(key: string): number;
}

export function rewindKey(rewindId: string): string {
  return `rewind:${rewindId}`;
}

export function timelineItemPlace(item: ChatTimelineItem): string {
  if (item.kind === 'entry') return `feed row ${entryPlace(item.entry)}`;
  if (item.kind === 'step') return `feed step ${item.row.kind === 'step' ? entryPlace(item.row.entry) : item.row.kind}`;
  if (item.kind === 'tail') return `feed ${item.slot}`;
  return `feed ${item.kind}`;
}

function entryPlace(entry: ChatEntry): string {
  return entry.kind === 'tool' ? `tool ${entry.toolName}` : entryKindOf(entry);
}

const tailItem = (slot: ChatTailSlot): ChatTimelineItem => ({
  kind: 'tail',
  key: `tail:${slot}`,
  slot,
  estimate: tailEstimate(slot) + FEED_GAP_PX,
  spaced: true,
});

export const CHAT_TAIL_ITEMS: Readonly<Record<ChatTailSlot, ChatTimelineItem>> = {
  'ready-answers': tailItem('ready-answers'),
  notice: tailItem('notice'),
};

export function sameTimelineItem(held: ChatTimelineItem, next: ChatTimelineItem): boolean {
  if (held.kind === 'tail') return next.kind === 'tail' && held.slot === next.slot;
  if (next.kind === 'tail') return false;
  if (
    held.dayBefore !== next.dayBefore ||
    held.estimate !== next.estimate ||
    held.spaced !== next.spaced ||
    held.keepAlive !== next.keepAlive ||
    held.open !== next.open
  ) {
    return false;
  }
  if (held.kind === 'status') {
    return next.kind === 'status' && held.stretch === next.stretch && held.place === next.place;
  }
  if (held.kind === 'entry') return next.kind === 'entry' && held.entry === next.entry;
  if (held.kind === 'rewind') {
    return (
      next.kind === 'rewind' &&
      held.rewind === next.rewind &&
      held.scope === next.scope &&
      held.turns === next.turns &&
      held.words === next.words &&
      held.open === next.open
    );
  }
  if (held.kind === 'stretch') {
    return (
      next.kind === 'stretch' &&
      held.thoughts === next.thoughts &&
      held.group.id === next.group.id &&
      sameEntries(held.group.entries, next.group.entries)
    );
  }
  return (
    next.kind === 'step' &&
    held.stretch === next.stretch &&
    held.place === next.place &&
    held.bare === next.bare &&
    held.live === next.live &&
    sameActivityRow(held.row, next.row)
  );
}

function sameActivityRow(held: ActivityRow, next: ActivityRow): boolean {
  if (held.kind !== next.kind) return false;
  if (held.kind === 'step') return next.kind === 'step' && held.entry === next.entry;
  return next.kind !== 'step' && sameEntries(held.entries, next.entries);
}

function sameEntries(held: readonly ActivityEntry[], next: readonly ActivityEntry[]): boolean {
  return held.length === next.length && held.every((entry, index) => entry === next[index]);
}

export function timelineBodyArrivesLate(item: ChatTimelineItem): boolean {
  return item.kind === 'entry' && item.entry.kind === 'assistant' && item.entry.text.trim().length > 0;
}

export function timelineItemRewound(item: ChatTimelineItem): boolean {
  if (item.kind === 'entry') return item.entry.rewound !== undefined;
  if (item.kind === 'stretch') return item.group.entries[0]?.rewound !== undefined;
  if (item.kind === 'step') return activityRowEntries(item.row)[0]?.rewound !== undefined;
  return false;
}

export function stretchOnScreen(item: (key: string) => ChatTimelineItem | undefined, key: string, visible: readonly string[]): boolean {
  return visible.some((shown) => {
    const held = item(shown);
    return held !== undefined && (held.key === key || (held.kind === 'step' && !held.live && held.stretch === key));
  });
}

export function itemOccurredAt(item: Exclude<ChatTimelineItem, { kind: 'tail' | 'status' }>): string | undefined {
  if (item.kind === 'entry') return item.entry.occurredAt;
  if (item.kind === 'rewind') return item.occurredAt;
  if (item.kind === 'stretch') return item.group.entries.find((entry) => entry.occurredAt)?.occurredAt;
  return activityRowEntries(item.row).find((entry) => entry.occurredAt)?.occurredAt;
}

function activityRowEntries(row: ActivityRow): readonly ActivityEntry[] {
  return row.kind === 'step' ? [row.entry] : row.entries;
}
