import { HistoryFold, moveThreadHistory } from '../../HistoryFold';
import { threadEventFact } from '../../ThreadEventDoor';
import { decodeThreadEventPayload, type ThreadEventPayload } from '../../events';
import type { ThreadContextReading, ThreadHistory } from '../../rows';
import type { ThreadPatch } from '../aggregate';
import { TranscriptFold } from '../../../transcript/TranscriptFold';
import type { ThreadEventFact } from '../../../transcript/eventFold';
import type { ThreadTranscript } from '../../../transcript/rows';
import type { ThreadEventRow } from '../eventLog';
import type { HeldThread } from './state';
import type { ThreadEntryReader } from '../../../transcript/kinds';

function bodyOf(kinds: ThreadEntryReader, event: ThreadEventRow): { kind: string; payload: ThreadEventPayload } {
  return { kind: event.kind, payload: decodeThreadEventPayload(kinds, event.threadId, event.payload) };
}

export function placed(fact: ThreadEventFact): boolean {
  return (
    fact.entry !== undefined ||
    fact.withdrawn !== undefined ||
    fact.rewound !== undefined ||
    fact.restored !== undefined ||
    fact.branched !== undefined
  );
}

export function historyOf(kinds: ThreadEntryReader, held: HeldThread): ThreadHistory {
  let fold: HistoryFold | undefined;
  for (const event of held.events) {
    if (event.position <= held.historyThrough) continue;
    const body = bodyOf(kinds, event);
    if (moveThreadHistory(body) === null) continue;
    fold ??= new HistoryFold(held.history);
    fold.fold(body, event.position);
  }
  return fold?.take() ?? held.history;
}

export function transcriptOf(kinds: ThreadEntryReader, held: HeldThread): ThreadTranscript {
  const suffix = held.events.filter((event) => event.position > held.entriesThrough);
  if (suffix.length === 0) return held.transcript;
  const fold = new TranscriptFold(held.transcript);
  for (const event of suffix) {
    const fact = threadEventFact(bodyOf(kinds, event));
    if (placed(fact)) fold.place(fact);
  }
  return fold.take();
}

export function project(kinds: ThreadEntryReader, held: HeldThread): ReadonlySet<string> {
  const claimed = new Set<string>();
  const suffix = held.events.filter((event) => event.position > held.entriesThrough);
  if (suffix.length === 0) return claimed;
  const fold = new TranscriptFold(held.transcript);
  for (const event of suffix) {
    const fact = threadEventFact(bodyOf(kinds, event));
    if (fact.entry !== undefined) claimed.add(fact.entry.id);
    if (placed(fact)) fold.place(fact);
  }
  held.transcript = [...fold.take()];
  held.entriesThrough = suffix[suffix.length - 1]!.position;
  return claimed;
}

export function headOf(held: HeldThread): number {
  return held.events[held.events.length - 1]?.position ?? 0;
}

export function applyColumns(held: HeldThread, patch: ThreadAtomicColumns, updatedAt: Date): void {
  const { systemPrompt, pendingSystemPrompt, ...columns } = patch;
  if (systemPrompt !== undefined) held.systemPrompt = systemPrompt;
  if (pendingSystemPrompt !== undefined) held.pendingSystemPrompt = pendingSystemPrompt;
  const defined = Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== undefined));
  held.row = { ...held.row, ...defined, updatedAt };
  held.foldRev += 1;
}

export type ThreadAtomicColumns = ThreadPatch & { readonly contextReading?: ThreadContextReading | null };
