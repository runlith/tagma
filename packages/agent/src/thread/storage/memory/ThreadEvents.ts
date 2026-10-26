import { attempt } from './attempt';
import { threadEntryIdentity } from '../../ThreadQuery';
import type { ThreadEventPayload } from '../../events';
import type { ThreadEventLogStorage, ThreadEventRow, ThreadRecordWindow } from '../eventLog';
import { headOf } from './folds';
import type { MemoryStorageInput } from './state';
import type { MemoryTx } from './units';

export function makeMemoryEvents({ memory }: MemoryStorageInput): ThreadEventLogStorage<MemoryTx> {
  const within = (threadId: string, window: ThreadRecordWindow): readonly ThreadEventRow[] =>
    (memory.held(threadId)?.events ?? []).filter(
      (row) =>
        row.position > window.afterPosition &&
        row.position <= window.head &&
        (window.kinds === undefined || window.kinds.includes(row.kind)),
    );
  return {
    append: (event, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('append', () => {
            const standing = memory.eventIds.get(event.id);
            if (standing !== undefined) {
              const held = standing === event.threadId ? memory.held(standing) : undefined;
              const same = held?.events.find((row) => row.id === event.id);
              if (same && same.kind === event.kind && JSON.stringify(same.payload) === JSON.stringify(event.payload)) return same;
              throw new Error(`Thread event ${event.id} is already taken by another fact.`);
            }
            const held = memory.held(event.threadId);
            if (!held) throw new Error(`Thread ${event.threadId} holds no log to append to.`);
            unit.keep(held);
            const row: ThreadEventRow = {
              threadId: event.threadId,
              position: headOf(held) + 1,
              id: event.id,
              kind: event.kind,
              payload: event.payload,
            };
            held.events.push(row);
            held.foldRev += 1;
            unit.put(memory.eventIds, event.id, event.threadId);
            return row;
          }),
        tx,
      ),
    recordsAsOf: (threadId, window, tx) =>
      attempt('recordsAsOf', () => memory.read(tx, () => within(threadId, window).slice(0, window.limit))),
    revisionsAsOf: (threadId, window, tx) =>
      attempt('revisionsAsOf', () =>
        memory.read(tx, () => {
          const identified = within(threadId, window).flatMap((row) => {
            const identity = threadEntryIdentity(row.payload as ThreadEventPayload);
            return identity === null || (row.payload.entry as { id?: unknown } | undefined)?.id === undefined ? [] : [{ ...row, identity }];
          });
          const latest = new Map<string, number>();
          for (const row of memory.held(threadId)?.events ?? []) {
            if (row.position > window.head) break;
            const identity = threadEntryIdentity(row.payload as ThreadEventPayload);
            if (identity !== null && (row.payload.entry as { id?: unknown } | undefined)?.id !== undefined)
              latest.set(identity, row.position);
          }
          return identified.filter((row) => latest.get(row.identity) === row.position).slice(0, window.limit);
        }),
      ),
    eventsAfter: (threadId, afterPosition, limit, tx) =>
      attempt('eventsAfter', () =>
        memory.read(tx, () => (memory.held(threadId)?.events ?? []).filter((row) => row.position > afterPosition).slice(0, limit)),
      ),
    headPosition: (threadId, tx) =>
      attempt('headPosition', () =>
        memory.read(tx, () => {
          const held = memory.held(threadId);
          return held ? headOf(held) : 0;
        }),
      ),
    positionOf: (threadId, recordId, tx) =>
      attempt('positionOf', () =>
        memory.read(tx, () => {
          const events = memory.held(threadId)?.events ?? [];
          const exact = events.findLast((row) => row.id === recordId);
          if (exact) return exact.position;
          const named = events.findLast((row) => {
            const entry = row.payload.entry as { id?: unknown } | undefined;
            return entry?.id === recordId || threadEntryIdentity(row.payload as ThreadEventPayload) === recordId;
          });
          return named?.position ?? null;
        }),
      ),
  };
}
