import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister, SignedSession } from '../../platform/contract/service/writers.js';
import { BlockNames, type ActEntry } from '../contract/service/acts.js';
import type { GraphServices } from '../contract/service/services.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type JournalPayloadUnreadable, readJournal } from '../contract/wire/journalPayloads.js';
import { GraphJournal } from '../contract/service/journal.js';
import type { CallJournalRange, CallRecorded, JournalReading } from '../contract/wire/callRange.js';
import type { CallKey } from '../../platform/contract/wire/ids.js';
import { GraphCall } from '../contract/service/serving.js';

const bodySize = Effect.fnUntraced(function* (
  rows: readonly ActEntry[],
): Effect.fn.Return<{ chars?: { from: number; to: number } }, JournalPayloadUnreadable> {
  let from: number | undefined;
  let to: number | undefined;
  for (const row of rows) {
    if (row.op !== 'update') continue;
    const read = readJournal.update(row);
    if (read._tag === 'Failure') return yield* read.failure;
    const entry = read.success;
    if (entry.wasChars === undefined || entry.chars === undefined) continue;
    from ??= entry.wasChars;
    to = entry.chars;
  }
  return from === undefined || to === undefined || from === to ? {} : { chars: { from, to } };
});

const callRows = Effect.fnUntraced(function* (callId: string): Effect.fn.Return<ActEntry[], StoreFailure, GraphServices> {
  const signed = yield* SignedSession;
  if (signed === null) return yield* (yield* GraphJournal).byCall(callId, null);
  const sessionId = yield* (yield* WriterRegister).idOf(signed);
  return sessionId === null ? [] : yield* (yield* GraphJournal).byCall(callId, sessionId);
});

export function journalRange(projectId: number) {
  return (callId: string, name: string): Effect.Effect<JournalReading, never, GraphServices> => {
    const reading: Effect.Effect<CallJournalRange | null, StoreFailure | GateRefusal | JournalPayloadUnreadable, GraphServices> =
      Effect.gen(function* () {
        const rows = yield* callRows(callId);
        if (rows.length === 0) return null;
        const blockId = yield* (yield* BlockNames).idOfName(name);
        const own = rows.filter((row) => row.blockId === blockId && row.projectId === projectId);
        const first = own[0];
        const last = own[own.length - 1];
        if (first === undefined || last === undefined) return null;
        return { from: first.id - 1, to: last.id, ...(yield* bodySize(own)) };
      });
    return Effect.map(Effect.result(reading), (result): JournalReading =>
      result._tag === 'Success'
        ? { status: 'read', range: result.success }
        : { status: 'unreadable', reason: result.failure instanceof Error ? result.failure.message : String(result.failure) },
    );
  };
}

export const recordedByCall = (projectId: number) =>
  Effect.fnUntraced(function* (callId: string): Effect.fn.Return<CallRecorded | null, StoreFailure | GateRefusal, GraphServices> {
    const rows = (yield* callRows(callId)).filter((row) => row.projectId === projectId);
    if (rows.length === 0) return null;
    const blockNames = yield* BlockNames;
    const names = yield* blockNames.namesOf(rows.flatMap((row) => (row.blockId === null ? [] : [row.blockId])));
    return {
      status: 'ok',
      landed: {
        at: (rows[0] as ActEntry).ts.toISOString(),
        acts: rows.map((row) => ({
          op: row.op,
          blockName: row.blockId === null ? null : (names.get(row.blockId) ?? null),
        })),
      },
    };
  });

export const settleJournalCall = Effect.fnUntraced(function* (key: CallKey) {
  const call = yield* yield* GraphCall;
  const recorded = yield* recordedByCall(call.project.id)(key.key);
  return recorded === null ? { status: 'not-happened' as const, evidence: null } : { status: 'happened' as const, evidence: recorded };
});
