import { Effect, Result } from 'effect';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { decodeThreadEventPayloadResult } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { setRested } from '../rest.js';
import { threadMandate } from '../store/mandate.js';
import { session } from '../../platform/store/writers.js';
import { basename, dirname } from 'node:path';
import { conversationWrites, threadBase, threadEvent, threadJournalPlace, threadRolloutCursor } from '../store/journal.js';
import { threadResource } from '../store/tables.js';
import {
  type CarriedRecord,
  type FoldRow,
  importRolloutMeta,
  type NativeFolds,
  revived,
  type Row,
  type RolloutLayer,
  type RolloutMeta,
  type RolloutParts,
} from './rolloutMeta.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import {
  type Rollout,
  type RolloutRecord,
  type RolloutUnreadable,
  appendRolloutItem,
  recordVerdict,
  replayRollout,
  rolloutEventOf,
} from './rolloutFile.js';
import { RolloutSyncRefused } from './export.js';
import { threadEntry } from '../store/kernel.js';
import { foldedBody, foldedEntryId, restoredFact } from './foldedFacts.js';
import { dropJournal } from './rest.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { conversationCarried, speaks } from './conversationIndex.js';

const CARRY_UNIT_PARAMS = 60_000;
const CARRY_UNIT_BYTES = 32 * 1024 * 1024;
const EVENT_INSERT_ROWS = 2_000;

type CarryPlan = {
  readonly batches: readonly (readonly FoldRow[])[];
  readonly through: number;
  readonly records: number;
};

const carryPlan = Effect.fnUntraced(function* (threadId: string, rollout: Rollout, native: NativeFolds | null) {
  const kinds = yield* ThreadEntryKinds;
  const records: CarriedRecord[] = [];
  const rows: FoldRow[] = [];
  let through = 0;
  for (const item of rollout.items) {
    const verdict = recordVerdict(item);
    if (verdict.kind === 'unreadable') {
      return yield* Effect.fail(new RolloutSyncRefused({ reason: 'record-shape', message: verdict.reason }));
    }
    if (verdict.kind === 'read-past') continue;
    const revivedRow = revived(verdict.row);
    if (verdict.record !== 'event') {
      records.push({ record: verdict.record, row: revivedRow });
      continue;
    }
    const decoded = decodeThreadEventPayloadResult(kinds, revivedRow.payload);
    if (Result.isFailure(decoded)) {
      return yield* new RolloutSyncRefused({
        reason: 'record-shape',
        message: `the event at position ${verdict.position} cannot be read: ${decoded.failure.message}`,
      });
    }
    const row = { ...revivedRow, payload: decoded.success };
    records.push({ record: 'event', row, event: { kind: String(revivedRow.kind), payload: decoded.success } });
    through = verdict.position;
    rows.push({ kind: 'event', row, weight: 5, bytes: sizeOf(row) });
  }
  if (native !== null) rows.push(...native.rows(threadId, records));
  const batches: FoldRow[][] = [];
  let batch: FoldRow[] = [];
  let params = 0;
  let bytes = 0;
  for (const row of rows) {
    if (batch.length > 0 && (params + row.weight > CARRY_UNIT_PARAMS || bytes + row.bytes > CARRY_UNIT_BYTES)) {
      batches.push(batch);
      batch = [];
      params = 0;
      bytes = 0;
    }
    batch.push(row);
    params += row.weight;
    bytes += row.bytes;
  }
  if (batch.length > 0) batches.push(batch);
  return { batches, through, records: records.length } satisfies CarryPlan;
});

function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

const writeBatch = Effect.fnUntraced(function* (
  threadId: string,
  batch: readonly FoldRow[],
  native: NativeFolds | null,
  unit: WriteUnit<'machine'>,
  retained = false,
) {
  const { db } = yield* MachineStore;
  const events = batch.filter((row) => row.kind === 'event').map(({ row }) => row as typeof threadEvent.$inferInsert);
  for (let at = 0; at < events.length; at += EVENT_INSERT_ROWS) {
    yield* db
      .insert(threadEvent)
      .values(events.slice(at, at + EVENT_INSERT_ROWS))
      .onConflictDoNothing();
  }
  const first = events[0];
  const last = events.at(-1);
  if (first !== undefined && last !== undefined) {
    const spoken = events.filter((event) => speaks(event.payload)).map((event) => ({ position: event.position, payload: event.payload }));
    yield* conversationCarried(db, unit, threadId, first.position - 1, last.position, spoken);
  }
  if (native !== null) yield* native.write(batch.filter((row) => row.kind !== 'event' && !(retained && row.kind === 'entry')));
});

const carryThreadRecords = Effect.fnUntraced(function* (
  threadId: string,
  rollout: Rollout,
  parts: RolloutParts,
  unit: WriteUnit<'machine'>,
) {
  const { db } = yield* MachineStore;
  const native = (yield* parts.native.folds.present(threadId)) ? parts.native.folds : null;
  const plan = yield* carryPlan(threadId, rollout, native);
  for (const batch of plan.batches) yield* writeBatch(threadId, batch, native, unit);
  if (native !== null) yield* native.settle(threadId, plan.through);
  const carried = { nextByteOffset: rollout.bytes, nextPosition: plan.through + 1 };
  yield* db
    .insert(threadRolloutCursor)
    .values({ threadId, ...carried })
    .onConflictDoUpdate({ target: threadRolloutCursor.threadId, set: carried });
});

const keptInFile = Effect.fn('ThreadRollout.rehydrate.keep')(function* (threadId: string, path: string, rollout: Rollout) {
  const store = yield* MachineStore;
  const { db } = store;
  const filed = new Set<string>();
  let last = 0;
  for (const item of rollout.items) {
    const event = rolloutEventOf(item);
    if (event === null) continue;
    filed.add(event.id);
    last = Math.max(last, event.position);
  }
  const standing = yield* db
    .select({ position: threadEvent.position, id: threadEvent.id })
    .from(threadEvent)
    .where(eq(threadEvent.threadId, threadId))
    .orderBy(asc(threadEvent.position));
  const absent = standing.filter((row) => !filed.has(row.id)).map((row) => row.position);
  if (absent.length === 0) return rollout;
  for (let at = 0; at < absent.length; at += KEPT_ROWS) {
    yield* keepRows(threadId, path, absent.slice(at, at + KEPT_ROWS), last);
    last += Math.min(KEPT_ROWS, absent.length - at);
  }
  const kept = yield* replayRollout(path);
  const key = { nextByteOffset: kept.bytes, nextPosition: last + 1 };
  yield* store.transaction(writes('thread.rehydrate.keep', [threadRolloutCursor]), (unit) =>
    Effect.asVoid(unit.run(db.update(threadRolloutCursor).set(key).where(eq(threadRolloutCursor.threadId, threadId)))),
  );
  return kept;
});

const KEPT_ROWS = 500;

const keepRows = Effect.fnUntraced(function* (threadId: string, path: string, positions: readonly number[], after: number) {
  const { db } = yield* MachineStore;
  const rows = yield* db
    .select({ id: threadEvent.id, kind: threadEvent.kind, payload: threadEvent.payload, body: threadEntry.entry })
    .from(threadEvent)
    .leftJoin(threadEntry, foldedBody)
    .where(and(eq(threadEvent.threadId, threadId), inArray(threadEvent.position, [...positions])))
    .orderBy(asc(threadEvent.position));
  let last = after;
  for (const row of rows) {
    if (foldedEntryId(row.payload) !== null && row.body === null) {
      return yield* new RolloutSyncRefused({
        reason: 'record-shape',
        message: `the event ${row.id} stands only in the database and its folded body is gone, so it cannot be kept in the rollout`,
      });
    }
    last += 1;
    const payload = foldedEntryId(row.payload) === null ? row.payload : restoredFact(row.payload, row.body);
    yield* appendRolloutItem(path, { kind: 'event', row: { threadId, position: last, id: row.id, kind: row.kind, payload } });
  }
});

export const rehydrateThreadRecords = Effect.fn('ThreadRollout.rehydrate.carry')(function* (input: {
  readonly threadId: string;
  readonly path: string;
  readonly parts: RolloutParts;
}) {
  yield* Effect.annotateCurrentSpan({ threadId: input.threadId });
  const store = yield* MachineStore;
  const { db } = store;
  const folds = input.parts.native.folds;
  const rollout = yield* keptInFile(input.threadId, input.path, yield* replayRollout(input.path));
  const native = (yield* folds.present(input.threadId)) ? folds : null;
  const plan = yield* carryPlan(input.threadId, rollout, native);
  yield* store.transaction(writes('thread.rehydrate.release', [], folds.writes), () => folds.release(input.threadId));
  yield* dropJournal(input.threadId, folds, false);
  const retained =
    (yield* db.select({ ord: threadEntry.ord }).from(threadEntry).where(eq(threadEntry.threadId, input.threadId)).limit(1).get()) !==
    undefined;
  for (const batch of plan.batches) {
    yield* store.transaction(writes('thread.rehydrate.rows', [threadEvent], folds.writes, conversationWrites), (unit) =>
      writeBatch(input.threadId, batch, native, unit, retained),
    );
  }
  yield* store.transaction(writes('thread.rehydrate.finish', [threadRolloutCursor], folds.writes), (unit) =>
    Effect.gen(function* () {
      if (native !== null) yield* native.settle(input.threadId, plan.through);
      yield* db
        .insert(threadRolloutCursor)
        .values({ threadId: input.threadId, nextByteOffset: rollout.bytes, nextPosition: plan.through + 1 })
        .onConflictDoUpdate({
          target: threadRolloutCursor.threadId,
          set: { nextByteOffset: rollout.bytes, nextPosition: plan.through + 1 },
        });
      yield* setRested(db, unit, input.threadId, null);
    }),
  );
  yield* Effect.annotateCurrentSpan({ records: plan.records, units: plan.batches.length + 2 });
});

export type RolloutSources = ReadonlyMap<string, Rollout>;

const prefixOf = Effect.fnUntraced(function* (threadId: string, base: readonly RolloutLayer[], sources: RolloutSources | undefined) {
  const taken = new Map<number, RolloutRecord>();
  for (const layer of base) {
    for (const item of sources?.get(layer.sourceId)?.items ?? []) {
      const event = rolloutEventOf(item);
      if (event === null || event.position <= layer.afterPosition || event.position > layer.throughPosition) continue;
      taken.set(event.position, { kind: 'event', row: { ...event, threadId, id: `${threadId}:${event.position}` } });
    }
  }
  for (const layer of base) {
    for (let position = layer.afterPosition + 1; position <= layer.throughPosition; position += 1) {
      if (taken.has(position)) continue;
      return yield* new RolloutSyncRefused({
        reason: 'thread-missing',
        message: `thread ${threadId} reads position ${position} through ${layer.sourceId}, and no rollout of its sources holds it`,
      });
    }
  }
  return [...taken].sort(([left], [right]) => left - right).map(([, record]) => record);
});

const positionOf = (record: RolloutRecord): number => rolloutEventOf(record)?.position ?? 0;

const inherited = (prefix: readonly RolloutRecord[], items: readonly RolloutRecord[]): readonly RolloutRecord[] => {
  const own = items.filter((item) => rolloutEventOf(item) !== null);
  const merged: RolloutRecord[] = [];
  let at = 0;
  for (const event of own) {
    while (at < prefix.length && positionOf(prefix[at]!) < positionOf(event)) merged.push(prefix[at++]!);
    merged.push(event);
  }
  merged.push(...prefix.slice(at));
  return [...merged, ...items.filter((item) => rolloutEventOf(item) === null)];
};

const metaOf = (rollout: Rollout): Partial<RolloutMeta> | null => {
  const moved = rollout.items.filter((item) => item.kind === 'meta').at(-1);
  return (moved === undefined ? rollout.meta : moved.meta) as Partial<RolloutMeta> | null;
};

export const rolloutBase = (path: string): Effect.Effect<readonly RolloutLayer[], RolloutUnreadable> =>
  Effect.map(replayRollout(path), (rollout) => metaOf(rollout)?.base ?? []);

export const replayThreadRollout = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly parts: RolloutParts;
  readonly records: ThreadRecords['Service'];
  readonly sources?: RolloutSources;
}) {
  const store = yield* MachineStore;
  const { db } = store;
  const read = yield* replayRollout(input.path);
  const meta = metaOf(read);
  const base = meta?.base ?? [];
  const prefix = base.length === 0 || meta?.record == null ? [] : yield* prefixOf(String(meta.record.id), base, input.sources);
  const rollout = prefix.length === 0 ? read : { ...read, items: inherited(prefix, read.items) };
  const journal = Number(basename(dirname(input.path)));
  const threadId = yield* store.transaction(
    writes(
      'thread.rollout',
      [threadRecord, threadMandate, session, threadEvent, threadRolloutCursor, threadResource, threadBase, threadJournalPlace],
      input.parts.native.writes,
      input.parts.native.folds.writes,
      input.parts.external.writes,
      conversationWrites,
    ),
    (unit) =>
      Effect.gen(function* () {
        const id = yield* importRolloutMeta(meta, input.parts, input.records, unit);
        if (id === null) return null;
        if (Number.isSafeInteger(journal) && journal !== meta?.record?.projectId) {
          yield* db.insert(threadJournalPlace).values({ threadId: id, projectId: journal }).onConflictDoNothing();
        }
        if (prefix.length > 0) {
          yield* db.insert(threadBase).values(
            base.map((layer, depth) => ({
              threadId: id,
              depth,
              sourceId: layer.sourceId,
              lowOrd: 1,
              highOrd: 0,
              afterPosition: layer.throughPosition,
              throughPosition: layer.throughPosition,
              prompts: 'kept' as const,
              hidden: [],
              unfiled: true,
            })),
          );
        }
        yield* carryThreadRecords(id, rollout, input.parts, unit);
        for (const record of rollout.items) {
          if (record.kind !== 'hold' || record.row === undefined) continue;
          yield* db.insert(threadResource).values(revived(record.row) as typeof threadResource.$inferInsert);
        }
        return id;
      }),
  );
  if (threadId === null) {
    return yield* new RolloutSyncRefused({ reason: 'record-shape', message: 'the meta line carries no record' });
  }
  return { threadId, inherited: prefix.length };
});
