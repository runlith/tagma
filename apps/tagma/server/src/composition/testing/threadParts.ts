import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { nativeThreadRows, threadStore, type ThreadStore } from '../../native-harness/testing/doubles.js';

import { sessionLookups } from '../../threads/testing/doubles.js';
import { threadListReads } from '../../threads/testing/doubles.js';
import { threadLiveSpells } from '../../threads/testing/doubles.js';
import { mandateRows } from '../../threads/testing/doubles.js';

export type ThreadParts = Effect.Success<ReturnType<typeof threadParts>>;

export const threadParts = Effect.fnUntraced(function* (options: {
  readonly db: StoreDb<'machine'>;
  readonly units: MachineUnits['Service'];
  readonly threads: ThreadStore;
  readonly records: ThreadRecords['Service'];
}) {
  const { db, units, threads, records } = options;
  return {
    list: yield* threadListReads(threads, records, threads.kinds),
    rows: yield* nativeThreadRows(threads, records),
    lookups: yield* sessionLookups(),
    mandate: yield* mandateRows(),
    spells: yield* threadLiveSpells(),
  };
});

export const threadStack = Effect.fnUntraced(function* (options: {
  readonly db: StoreDb<'machine'>;
  readonly units: MachineUnits['Service'];
  readonly records: ThreadRecords['Service'];
  readonly kinds: ThreadEntryReader;
}) {
  const store = yield* threadStore(options.records, options.kinds);
  return { store, threads: yield* threadParts({ ...options, threads: store }) };
});
