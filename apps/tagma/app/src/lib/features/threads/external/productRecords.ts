import { THREADS_ENTRY_KINDS } from '@tagma/server/threads/contract/wire/entryKinds';
import { TRANSPORT_ENTRY, type TransportEntry } from '@tagma/server/threads/contract/wire/harness/transportEntry';
import { productEntry, productId } from '@runlith/chat-ui/entries';
import { productKind } from '@runlith/chat-ui/EntryKinds.svelte';
import { productRecord } from '../native/records.js';

export const TRANSPORT_SWITCH = 'transport-switch';
export const transportSwitchId = productId<TransportEntry>(TRANSPORT_SWITCH);
export const transportSwitchKind = productKind(transportSwitchId);
export const entryKinds = THREADS_ENTRY_KINDS;
export const productRecords = [
  productRecord<TransportEntry>(TRANSPORT_ENTRY, (entry, base) => productEntry(transportSwitchId, base, entry)),
];
