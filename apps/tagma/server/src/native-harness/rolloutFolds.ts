import { HistoryFold } from '@runlith/agent/thread/HistoryFold';
import { threadEventFact } from '@runlith/agent/thread/ThreadEventDoor';
import { TranscriptFold } from '@runlith/agent/transcript/TranscriptFold';
import { crossingEntry, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore, type StoreFailure } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import {
  runIdOf,
  threadCompactionCheckpoint,
  threadHistoryItem,
  threadLog,
  threadPrunedToolCall,
  threadRev,
  typeOf,
} from './store/thread.js';
import { thread, threadEntry } from '../threads/store/kernel.js';
import { threadEvent } from '../threads/store/journal.js';
import { frozen, type FoldRow, type NativeFolds } from '../threads/journal/rolloutMeta.js';
import { RestedWork } from './transcript/restedWork.js';

const INSERT_ROWS = 8_000;

const RETURNED = writes('rollout.native.returned', [threadEntry, threadHistoryItem]);
const BODY_IDS = 500;

const INSERTED = {
  history: threadHistoryItem,
  entry: threadEntry,
  checkpoint: threadCompactionCheckpoint,
  pruned: threadPrunedToolCall,
} as const;

function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

const writeRun = Effect.fnUntraced(function* (kind: string, rows: readonly FoldRow[]): Effect.fn.Return<void, StoreFailure, MachineStore> {
  const { db } = yield* MachineStore;
  if (kind === 'retired') {
    for (const { row } of rows) {
      yield* db
        .delete(threadPrunedToolCall)
        .where(
          and(eq(threadPrunedToolCall.threadId, row.threadId as string), eq(threadPrunedToolCall.toolCallId, row.toolCallId as string)),
        );
    }
    return;
  }
  const table = INSERTED[kind as keyof typeof INSERTED];
  for (let at = 0; at < rows.length; at += INSERT_ROWS) {
    yield* db.insert(table).values(rows.slice(at, at + INSERT_ROWS).map(({ row }) => row) as never);
  }
});

export const nativeRows: NativeFolds['rows'] = (threadId, records) => {
  const history = new HistoryFold();
  const transcript = new TranscriptFold();
  const rows: FoldRow[] = [];
  for (const carried of records) {
    if (carried.record === 'event') {
      history.fold(carried.event);
      transcript.place(threadEventFact(carried.event));
    } else {
      rows.push({
        kind: carried.record === 'pruned-retired' ? 'retired' : carried.record,
        row: carried.row,
        weight: 5,
        bytes: sizeOf(carried.row),
      });
    }
  }
  for (const [ord, message] of history.take().entries()) {
    rows.push({ kind: 'history', row: { threadId, ord, message }, weight: 3, bytes: sizeOf(message) });
  }
  for (const [ord, entry] of transcript.take().entries()) {
    rows.push({
      kind: 'entry',
      row: { threadId, ord, entryId: entry.id, runId: runIdOf(entry), type: typeOf(entry), entry: crossingEntry(entry) },
      weight: 6,
      bytes: sizeOf(entry),
    });
  }
  return rows;
};

export const makeNativeFolds = Effect.gen(function* () {
  const work = yield* RestedWork;
  return {
    present: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      return (yield* db.select({ id: thread.id }).from(thread).where(eq(thread.id, threadId)).get()) !== undefined;
    }),
    revision: Effect.fnUntraced(function* (threadId, unit) {
      const { db } = yield* MachineStore;
      const query = db.select({ revision: threadRev.changeRev }).from(threadRev).where(eq(threadRev.threadId, threadId)).get();
      const row = yield* unit === undefined ? query : unit.run(query);
      return row?.revision ?? null;
    }),
    bodies: Effect.fnUntraced(function* (threadId, entryIds) {
      const { db } = yield* MachineStore;
      const bodies = new Map<string, unknown>();
      for (let at = 0; at < entryIds.length; at += BODY_IDS) {
        const rows = yield* db
          .select({ entryId: threadEntry.entryId, entry: threadEntry.entry })
          .from(threadEntry)
          .where(and(eq(threadEntry.threadId, threadId), inArray(threadEntry.entryId, entryIds.slice(at, at + BODY_IDS))));
        for (const row of rows) bodies.set(row.entryId, row.entry);
      }
      return bodies;
    }),
    held: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      const checkpoints = yield* db
        .select()
        .from(threadCompactionCheckpoint)
        .where(eq(threadCompactionCheckpoint.threadId, threadId))
        .orderBy(asc(threadCompactionCheckpoint.createdAt), asc(threadCompactionCheckpoint.id));
      const pruned = yield* db.select().from(threadPrunedToolCall).where(eq(threadPrunedToolCall.threadId, threadId));
      return { checkpoints: checkpoints.map(frozen), pruned: pruned.map(frozen) };
    }),
    heldKeys: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      const checkpoints = yield* db
        .select({ id: threadCompactionCheckpoint.id })
        .from(threadCompactionCheckpoint)
        .where(eq(threadCompactionCheckpoint.threadId, threadId));
      const pruned = yield* db
        .select({ toolCallId: threadPrunedToolCall.toolCallId })
        .from(threadPrunedToolCall)
        .where(eq(threadPrunedToolCall.threadId, threadId));
      return { checkpoints: checkpoints.map((row) => row.id), pruned: pruned.map((row) => row.toolCallId) };
    }),
    rows: nativeRows,
    write: Effect.fnUntraced(function* (rows) {
      let from = 0;
      for (let at = 1; at <= rows.length; at += 1) {
        if (at < rows.length && rows[at]!.kind === rows[from]!.kind) continue;
        yield* writeRun(rows[from]!.kind, rows.slice(from, at));
        from = at;
      }
    }),
    release: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      yield* db.delete(threadLog).where(eq(threadLog.threadId, threadId));
      yield* db.delete(threadPrunedToolCall).where(eq(threadPrunedToolCall.threadId, threadId));
      yield* db.delete(threadCompactionCheckpoint).where(eq(threadCompactionCheckpoint.threadId, threadId));
    }),
    drop: Effect.fnUntraced(function* (threadId, rows, retained) {
      const { db } = yield* MachineStore;
      const entries = retained
        ? []
        : yield* db
            .delete(threadEntry)
            .where(
              sql`(${threadEntry.threadId}, ${threadEntry.ord}) in (select ${threadEntry.threadId}, ${threadEntry.ord} from ${threadEntry} where ${threadEntry.threadId} = ${threadId} order by ${threadEntry.ord} limit ${rows})`,
            )
            .returning({ ord: threadEntry.ord });
      if (entries.length > 0) return entries.length;
      const history = yield* db
        .delete(threadHistoryItem)
        .where(
          sql`(${threadHistoryItem.threadId}, ${threadHistoryItem.ord}) in (select ${threadHistoryItem.threadId}, ${threadHistoryItem.ord} from ${threadHistoryItem} where ${threadHistoryItem.threadId} = ${threadId} order by ${threadHistoryItem.ord} limit ${rows})`,
        )
        .returning({ ord: threadHistoryItem.ord });
      return history.length;
    }),
    projected: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      const [row] = yield* db.all<{ behind: number }>(
        sql`select coalesce((select ${threadLog.entriesThrough} from ${threadLog} where ${threadLog.threadId} = ${threadId}), 0)
        < coalesce((select max(${threadEvent.position}) from ${threadEvent} where ${threadEvent.threadId} = ${threadId}), 0) as behind`,
      );
      return row?.behind !== 1;
    }),
    settle: Effect.fnUntraced(function* (threadId, through) {
      const { db } = yield* MachineStore;
      yield* db.insert(threadLog).values({ threadId, historyThrough: through, entriesThrough: through });
    }),
    transcribe: (files, key) =>
      Effect.flatMap(ThreadEntryKinds, (kinds) => Effect.asVoid(work.transcribe(kinds, files, key, { kind: 'staged' }))),
    stage: (files, stage) => Effect.flatMap(ThreadEntryKinds, (kinds) => work.stage(kinds, files, stage)),
    certify: (files) => Effect.flatMap(ThreadEntryKinds, (kinds) => work.certify(kinds, files)),
    digest: (files, form) => Effect.flatMap(ThreadEntryKinds, (kinds) => work.digest(kinds, files, form)),
    carry: (files, ask) => Effect.flatMap(ThreadEntryKinds, (kinds) => work.carry(kinds, files, ask)),
    layers: (files) => Effect.flatMap(ThreadEntryKinds, (kinds) => work.layers(kinds, files)),
    returned: {
      writes: RETURNED,
      columns: [
        { table: 'thread_entry', column: 'entry', record: 'entry' },
        { table: 'thread_history_item', column: 'message', record: 'message' },
      ],
    },
    writes: writes('rollout.native.folds', [threadEntry, threadHistoryItem, threadLog, threadPrunedToolCall, threadCompactionCheckpoint]),
  } satisfies NativeFolds;
});
