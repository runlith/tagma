import type { ThreadProductEntry, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ChatEntry, ChatEntryBase } from '@runlith/chat-ui/entries';
import { declaredIn, distinct, type DeclaringModules } from './contribution.js';

export type ProductRecord = {
  readonly id: string;
  project(entry: ThreadTranscriptEntry, base: ChatEntryBase): ChatEntry | null;
};

export function productRecord<E extends ThreadProductEntry>(
  type: string,
  project: (entry: E, base: ChatEntryBase) => ChatEntry | null,
): ProductRecord {
  return { id: type, project: (entry, base) => (entry.type === type ? project(entry as E, base) : null) };
}

export function collectRecords(modules: DeclaringModules): readonly ProductRecord[] {
  const declared = declaredIn<ProductRecord>(modules, 'productRecords');
  distinct(declared, (record) => [`Product record "${record.id}"`]);
  return declared.map((one) => one.item);
}

export function recordOf(records: readonly ProductRecord[], entry: ThreadTranscriptEntry): ChatEntry[] | null {
  const base: ChatEntryBase = { id: entry.id, runId: entry.runId, occurredAt: entry.occurredAt };
  for (const record of records) {
    const product = record.project(entry, base);
    if (product !== null) return [product];
  }
  return null;
}
