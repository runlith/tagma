import { Context, Effect, Layer } from 'effect';
import { makeCallSettlements, ToolSettlements, type CallSettlements } from '../agent/ToolSettlements';
import { ThreadEntryKinds, coreEntry } from '../transcript/kinds';
import { toolSettled } from '../transcript/entries';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import { decodeThreadEventPayload } from './events';
import { ThreadEventJournal } from './ThreadPorts';

export function recordedToolEntry(settlements: CallSettlements, entry: ThreadTranscriptEntry): void {
  if (!coreEntry(entry)) return;
  if (entry.type === 'tool' && entry.runId !== undefined && toolSettled(entry.toolState)) {
    settlements.recorded(entry.runId, entry.toolCallId);
  } else if (entry.type === 'run-end') settlements.ended(entry.runId);
}

export const threadToolSettlementsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const journal = yield* ThreadEventJournal;
    const kinds = yield* ThreadEntryKinds;
    const settlements = yield* makeCallSettlements;
    return Context.make(ToolSettlements, settlements).pipe(
      Context.add(ThreadEventJournal, {
        recordsAsOf: (threadId, window, tx) => journal.recordsAsOf(threadId, window, tx),
        revisionsAsOf: (threadId, window, tx) => journal.revisionsAsOf(threadId, window, tx),
        eventsAfter: (threadId, after, limit, tx) => journal.eventsAfter(threadId, after, limit, tx),
        headPosition: (threadId, tx) => journal.headPosition(threadId, tx),
        positionOf: (threadId, recordId, tx) => journal.positionOf(threadId, recordId, tx),
        append: (event, tx) =>
          Effect.tap(journal.append(event, tx), () => {
            if (event.kind !== 'tool' && event.kind !== 'run-end') return Effect.void;
            const { entry } = decodeThreadEventPayload(kinds, event.payload);
            return entry === undefined ? Effect.void : tx.afterCommit(Effect.sync(() => recordedToolEntry(settlements, entry)));
          }),
      }),
    );
  }),
);
