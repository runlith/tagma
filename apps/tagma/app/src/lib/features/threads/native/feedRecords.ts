import type { ThreadEntryKind } from '@runlith/agent/transcript/kinds';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ChatEntry } from '@runlith/chat-ui/entries';
import { createEntryKinds, type EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
import { collectRecords, recordOf } from './records.js';

const modules = import.meta.glob<Record<string, unknown>>('../**/productRecords.ts', { eager: true });
const declared = collectRecords(modules);

export function createFeedKinds(): EntryKinds {
  const kinds = createEntryKinds();
  for (const [contributor, module] of Object.entries(modules)) {
    for (const kind of (module.entryKinds ?? []) as readonly ThreadEntryKind[]) kinds.registerWire(contributor, kind);
  }
  return kinds;
}

export function feedRecord<E extends ThreadTranscriptEntry>(raw: E): ChatEntry[] | null {
  return recordOf(declared, raw);
}
