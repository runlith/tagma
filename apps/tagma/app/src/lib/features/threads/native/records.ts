import type { ThreadProductEntry, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ChatEntry, ChatEntryBase } from '@runlith/chat-ui/entries';
import { Point } from '@runlith/layer/Point';

export type ProductRecord = {
  readonly id: string;
  project(entry: ThreadTranscriptEntry, base: ChatEntryBase): ChatEntry | null;
};

export const ProductRecords = Point.define<ProductRecord>()('ProductRecords', { tier: 'app', key: (record) => record.id });

export function productRecord<E extends ThreadProductEntry>(
  type: string,
  project: (entry: E, base: ChatEntryBase) => ChatEntry | null,
): ProductRecord {
  return { id: type, project: (entry, base) => (entry.type === type ? project(entry as E, base) : null) };
}

export function recordOf(records: Point<ProductRecord>, entry: ThreadTranscriptEntry): ChatEntry[] | null {
  const base: ChatEntryBase = { id: entry.id, runId: entry.runId, occurredAt: entry.occurredAt };
  for (const record of records.items) {
    const product = record.project(entry, base);
    if (product !== null) return [product];
  }
  return null;
}
