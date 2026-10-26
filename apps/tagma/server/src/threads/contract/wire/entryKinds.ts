import type { ThreadEntryKind } from '@runlith/agent/transcript/kinds';
import { TRANSPORT_ENTRY, TransportEntry } from './harness/transportEntry.js';

export const THREADS_ENTRY_KINDS: readonly ThreadEntryKind[] = [{ type: TRANSPORT_ENTRY, schema: TransportEntry }];
