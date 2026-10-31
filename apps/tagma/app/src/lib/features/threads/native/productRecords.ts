import { START_ENTRY, StartEntry } from '@tagma/server/native-harness/contract/wire/start';
import type { ThreadCompositionEntry } from '@runlith/agent/transcript/entries';
import { productEntry, productId } from '@runlith/chat-ui/entries';
import { productKind } from '@runlith/chat-ui/EntryKinds.svelte';
import { productRecord } from './records.js';

const COMPOSITION = 'composition';
export const compositionId = productId<ThreadCompositionEntry>(COMPOSITION);
export const compositionKind = productKind(compositionId, { classify: () => ({ hidden: true }) });
const startId = productId<StartEntry>(START_ENTRY);
export const startKind = productKind(startId);
export const entryKinds = [{ type: START_ENTRY, schema: StartEntry }];

export const productRecords = [
  productRecord<ThreadCompositionEntry>(COMPOSITION, (entry, base) => productEntry(compositionId, base, entry)),
  productRecord<StartEntry>(START_ENTRY, (entry, base) => productEntry(startId, base, entry)),
];
