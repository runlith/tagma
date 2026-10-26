import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import { type ActivityEntry, type ActivityGroup, activityKey } from './activity';
import { type NoticeEntry, noticeEntry, sameNotice } from './notices';
import type { ChatEntry } from './entries';
import type { EntryKinds } from './EntryKinds.svelte';
import type { ChatTimelineItem } from './timeline';

export type Segment =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'activity'; group: ActivityGroup }
  | { kind: 'rewind'; by: string; scope: ThreadRewindScope; entries: ChatEntry[] };

export function marked(entries: readonly ChatEntry[]): boolean {
  return entries.some((entry) => entry.rewound !== undefined);
}

export function groupOf(kinds: EntryKinds, entry: ChatEntry): string {
  if (entry.rewound !== undefined) return `rewind:${entry.rewound.by}`;
  if (entry.runId && kinds.isMeta(entry)) return `meta:${entry.runId}`;
  if (!entry.runId && kinds.isRail(entry)) return `rail:${entry.id}`;
  return `entry:${entry.id}`;
}

export function segmentsOf(kinds: EntryKinds, entries: readonly ChatEntry[], fold: boolean): Segment[] {
  const segments: Segment[] = [];
  const rewinds = new Map<string, Extract<Segment, { kind: 'rewind' }>>();
  let open: { runId: string; entries: ActivityEntry[] } | null = null;
  const flush = () => {
    if (!open) return;
    const key = activityKey(open.entries[0]?.id ?? open.runId);
    segments.push({ kind: 'activity', group: { id: open.runId, key, entries: open.entries } });
    open = null;
  };
  let told: NoticeEntry[] | null = null;
  for (const entry of entries) {
    const chained: NoticeEntry[] | null = told;
    told = null;
    const mark = fold ? entry.rewound : undefined;
    if (mark !== undefined) {
      const held = rewinds.get(mark.by);
      if (held !== undefined) {
        held.entries.push(entry);
        continue;
      }
      flush();
      const opened: Extract<Segment, { kind: 'rewind' }> = { kind: 'rewind', by: mark.by, scope: mark.scope, entries: [entry] };
      rewinds.set(mark.by, opened);
      segments.push(opened);
      continue;
    }
    if (!entry.runId && kinds.isRail(entry)) {
      const notice = noticeEntry(entry) ? entry : null;
      if (notice !== null && chained?.[0] !== undefined && sameNotice(chained[0].notice, notice.notice)) {
        chained.push(notice);
        told = chained;
        continue;
      }
      flush();
      if (notice !== null) told = [notice];
      segments.push({ kind: 'activity', group: { id: entry.id, key: activityKey(entry.id), entries: told ?? [entry] } });
      continue;
    }
    if (entry.runId && kinds.isMeta(entry)) {
      if (open && open.runId !== entry.runId) flush();
      if (!open) open = { runId: entry.runId, entries: [] };
      open.entries.push(entry);
      continue;
    }
    flush();
    segments.push({ kind: 'entry', entry });
  }
  flush();
  return segments;
}

export function runsOf(wanted: ReadonlySet<number>): [number, number][] {
  const runs: [number, number][] = [];
  for (const at of [...wanted].sort((left, right) => left - right)) {
    const last = runs.at(-1);
    if (last !== undefined && last[1] + 1 === at) last[1] = at;
    else runs.push([at, at]);
  }
  return runs;
}

export function rowEntryIds(item: ChatTimelineItem): readonly string[] {
  if (item.kind === 'entry') return [item.entry.id];
  if (item.kind !== 'step') return [];
  return item.row.kind === 'step' ? [item.row.entry.id] : item.row.entries.map((entry) => entry.id);
}

export function localDayKey(occurredAt: string): string {
  const date = new Date(occurredAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export type Seg = {
  readonly key: string;
  readonly kind: Segment['kind'];
  readonly firstId: string;
  readonly ids: readonly string[];
  readonly items: number;
  readonly firstItem: string;
  readonly lines: number;
  readonly runId: string | undefined;
};

export type Emitted = { readonly seg: Seg; readonly bases: ChatTimelineItem[] };
