import { Effect } from 'effect';
import { decodeThreadEventPayload } from '../../events';
import { makeThreadEntryReader } from '../../../transcript/kinds';
import { threadEntryIdentity } from '../../ThreadQuery';
import type { ThreadEventInsert, ThreadEventRevision, ThreadEventRow, ThreadRecordWindow } from '../../storage/eventLog';
import { MemoryTx } from '../../storage/memory/units';
import { ThreadEventJournal } from '../../ThreadPorts';
import { ThreadStorageFailed } from '../../persisted';

export function recordingJournal(refuses: (event: ThreadEventInsert) => boolean = () => false) {
  const state: { rows: ThreadEventRow[] } = { rows: [] };
  const kinds = makeThreadEntryReader({ products: [] });
  const records = (threadId: string, window: ThreadRecordWindow) =>
    state.rows
      .filter(
        (row) =>
          row.threadId === threadId &&
          row.position > window.afterPosition &&
          row.position <= window.head &&
          (window.kinds === undefined || window.kinds.includes(row.kind)),
      )
      .slice(0, window.limit);
  const log = ThreadEventJournal.of({
    append: (event, tx) =>
      Effect.suspend(() => {
        if (refuses(event))
          return Effect.fail(new ThreadStorageFailed({ call: 'append', cause: new Error('The event log refused the append.') }));
        if (tx !== undefined) {
          if (!(tx instanceof MemoryTx))
            return Effect.fail(new ThreadStorageFailed({ call: 'append', cause: new Error('This journal uses memory write units.') }));
          tx.keep(state);
        }
        const row = { ...event, position: state.rows.length + 1 };
        state.rows.push(row);
        return Effect.succeed(row);
      }),
    eventsAfter: (threadId, after, limit) =>
      Effect.sync(() => state.rows.filter((row) => row.threadId === threadId && row.position > after).slice(0, limit)),
    recordsAsOf: (threadId, window) => Effect.sync(() => records(threadId, window)),
    revisionsAsOf: (threadId, window) =>
      Effect.sync(() => {
        const latest = new Map<string, ThreadEventRevision>();
        for (const row of records(threadId, { ...window, limit: Number.MAX_SAFE_INTEGER })) {
          const identity = threadEntryIdentity(decodeThreadEventPayload(kinds, row.payload));
          if (identity !== null) latest.set(identity, { ...row, identity });
        }
        return [...latest.values()].sort((a, b) => a.position - b.position).slice(0, window.limit);
      }),
    headPosition: (threadId) => Effect.sync(() => state.rows.findLast((row) => row.threadId === threadId)?.position ?? 0),
    positionOf: (threadId, id) =>
      Effect.sync(
        () =>
          state.rows.findLast((row) => {
            const entry = row.payload.entry;
            return (
              row.threadId === threadId &&
              (row.id === id || (typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === id))
            );
          })?.position ?? null,
      ),
  });
  return {
    get rows() {
      return state.rows;
    },
    log,
  };
}
