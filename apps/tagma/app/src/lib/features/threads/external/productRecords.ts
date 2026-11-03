import { THREADS_ENTRY_KINDS } from '@tagma/server/threads/contract/wire/entryKinds';
import { PICK_ENTRY, type PickEntry } from '@tagma/server/threads/contract/wire/harness/pick';
import { TRANSPORT_ENTRY, type TransportEntry } from '@tagma/server/threads/contract/wire/harness/transportEntry';
import { productEntry, productId } from '@runlith/chat-ui/entries';
import { productKind } from '@runlith/chat-ui/EntryKinds.svelte';
import { productRecord } from '../native/records.js';

const TRANSPORT_SWITCH = 'transport-switch';
const transportSwitchId = productId<TransportEntry>(TRANSPORT_SWITCH);
export const transportSwitchKind = productKind(transportSwitchId);
const pickId = productId<PickEntry>(PICK_ENTRY);
export const pickKind = productKind(pickId);
export const entryKinds = THREADS_ENTRY_KINDS;
export const productRecords = [
  productRecord<TransportEntry>(TRANSPORT_ENTRY, (entry, base) => productEntry(transportSwitchId, base, entry)),
  productRecord<PickEntry>(PICK_ENTRY, (entry, base) => productEntry(pickId, base, entry)),
];
