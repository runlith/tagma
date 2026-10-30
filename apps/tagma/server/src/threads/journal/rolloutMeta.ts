import { Effect } from 'effect';
import type { WorkerUnavailable } from '@runlith/utils/worker';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import type { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { threadResource } from '../store/tables.js';
import { threadBase, threadEvent, threadRolloutCursor, threadRolloutRefusal } from '../store/journal.js';
import { threadEntry } from '../store/kernel.js';
import { RolloutWriterFailed, type RolloutBirth } from './rolloutWriter.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadMandate } from '../store/mandate.js';
import { carriedRecap } from '../../thread-record/contract/wire/recap.js';
import type { RecordBirth, ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { RolloutFiles, TranscriptKey } from '../contract/service/rested.js';
import type { RolloutUnreadable } from './rolloutFile.js';
import type { RolloutStage, StagedFile } from './rolloutStaging.js';

import type { WriteUnit } from '../../platform/contract/service/units.js';

export type Row = Record<string, unknown>;

const DATE_FIELDS = [
  'createdAt',
  'updatedAt',
  'occurredAt',
  'readerOrderAt',
  'archivedAt',
  'pinnedAt',
  'movedAt',
  'detachedAt',
  'projectionEvictedAt',
  'heldAt',
] as const;

export function frozen(row: Row): Row {
  const out: Row = { ...row };
  for (const field of DATE_FIELDS) {
    if (out[field] instanceof Date) out[field] = (out[field] as Date).toISOString();
  }
  return out;
}

export function revived(row: Row): Row {
  const out: Row = { ...row };
  for (const field of DATE_FIELDS) {
    if (typeof out[field] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(out[field] as string)) {
      out[field] = new Date(out[field] as string);
    }
  }
  return out;
}

export type RolloutPart = {
  readonly read: (threadId: string) => Effect.Effect<Row | null, StoreFailure, MachineStore>;
  readonly write: (row: Row) => Effect.Effect<void, StoreFailure, MachineStore>;
  readonly writes: WriteSet;
};

export type CarriedRecord =
  | { readonly record: 'event'; readonly row: Row; readonly event: { readonly kind: string; readonly payload: ThreadEventPayload } }
  | { readonly record: 'checkpoint' | 'pruned' | 'pruned-retired'; readonly row: Row };

export type FoldRow = { readonly kind: string; readonly row: Row; readonly weight: number; readonly bytes: number };

export type NativeFolds = {
  readonly present: (threadId: string) => Effect.Effect<boolean, StoreFailure, MachineStore>;
  readonly bodies: (
    threadId: string,
    entryIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, unknown>, StoreFailure, MachineStore>;
  readonly held: (
    threadId: string,
  ) => Effect.Effect<{ readonly checkpoints: readonly Row[]; readonly pruned: readonly Row[] }, StoreFailure, MachineStore>;
  readonly heldKeys: (
    threadId: string,
  ) => Effect.Effect<{ readonly checkpoints: readonly string[]; readonly pruned: readonly string[] }, StoreFailure, MachineStore>;
  readonly rows: (threadId: string, records: readonly CarriedRecord[]) => readonly FoldRow[];
  readonly write: (rows: readonly FoldRow[]) => Effect.Effect<void, StoreFailure, MachineStore>;
  readonly release: (threadId: string) => Effect.Effect<void, StoreFailure, MachineStore>;
  readonly drop: (threadId: string, rows: number, retained: boolean) => Effect.Effect<number, StoreFailure, MachineStore>;
  readonly projected: (threadId: string) => Effect.Effect<boolean, StoreFailure, MachineStore>;
  readonly settle: (threadId: string, through: number) => Effect.Effect<void, StoreFailure, MachineStore>;
  readonly transcribe: (
    files: RolloutFiles,
    key: TranscriptKey,
  ) => Effect.Effect<void, RolloutUnreadable | WorkerUnavailable, ThreadEntryKinds>;
  readonly stage: (
    files: RolloutFiles,
    stage: RolloutStage,
  ) => Effect.Effect<StagedFile, RolloutUnreadable | WorkerUnavailable, ThreadEntryKinds>;
  readonly writes: WriteSet;
};

export type RolloutParts = { readonly native: RolloutPart & { readonly folds: NativeFolds }; readonly external: RolloutPart };

export type RolloutMeta = {
  readonly record: Row;
  readonly mandate: Row | null;
  readonly native: Row | null;
  readonly external: Row | null;
  readonly opener: Row | null;
  readonly base?: readonly RolloutLayer[];
};

export type RolloutLayer = { readonly sourceId: string; readonly afterPosition: number; readonly throughPosition: number };

export const isMetaRecord = (meta: unknown): boolean => {
  const envelope = meta as { record?: unknown; thread?: unknown } | null;
  return envelope !== null && typeof envelope === 'object' && (envelope.record != null || envelope.thread != null);
};

export const threadRolloutMeta = Effect.fnUntraced(function* (
  threadId: string,
  parts: RolloutParts,
): Effect.fn.Return<RolloutMeta | null, StoreFailure, MachineStore> {
  const { db } = yield* MachineStore;
  const row = yield* db
    .select({ record: threadRecord, mandate: threadMandate, opener: session })
    .from(threadRecord)
    .leftJoin(threadMandate, eq(threadMandate.id, threadRecord.id))
    .leftJoin(session, eq(session.id, threadRecord.createdBySessionId))
    .where(eq(threadRecord.id, threadId))
    .get();
  if (row === undefined) return null;
  const base = yield* db
    .select({ sourceId: threadBase.sourceId, afterPosition: threadBase.afterPosition, throughPosition: threadBase.throughPosition })
    .from(threadBase)
    .where(and(eq(threadBase.threadId, threadId), lt(threadBase.afterPosition, threadBase.throughPosition)))
    .orderBy(asc(threadBase.depth));
  return {
    record: frozen(row.record),
    mandate: row.mandate === null ? null : frozen(row.mandate),
    native: yield* parts.native.read(threadId),
    external: yield* parts.external.read(threadId),
    opener: row.opener === null ? null : frozen(row.opener as Row),
    base,
  };
});

export const rolloutBirth = (store: MachineStore['Service'], parts: RolloutParts): RolloutBirth =>
  Effect.fnUntraced(
    function* (threadId, unit) {
      const { db } = store;
      const prior = yield* unit.run(
        db
          .select({
            recorded: sql<number>`exists(select 1 from ${threadEvent} where ${threadEvent.threadId} = ${threadId})
        or exists(select 1 from ${threadEntry} where ${threadEntry.threadId} = ${threadId})
        or exists(select 1 from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadId})
        or exists(select 1 from ${threadRolloutRefusal} where ${threadRolloutRefusal.threadId} = ${threadId})`,
          })
          .from(threadRecord)
          .where(eq(threadRecord.id, threadId))
          .get(),
      );
      if (prior === undefined || prior.recorded !== 0) {
        return yield* new RolloutWriterFailed({
          reason: 'io',
          threadId,
          message: `thread ${threadId} has no birth row or records an earlier journal; its missing rollout cannot be initialized`,
        });
      }
      const meta = yield* unit.run(threadRolloutMeta(threadId, parts).pipe(Effect.provideService(MachineStore, store)));
      if (meta === null || meta.native?.systemPrompt != null) {
        return yield* new RolloutWriterFailed({
          reason: 'io',
          threadId,
          message: `thread ${threadId} cannot prove an unwritten journal; nothing was created`,
        });
      }
      const holds = yield* unit.run(
        db
          .select()
          .from(threadResource)
          .where(eq(threadResource.threadId, threadId))
          .orderBy(asc(threadResource.kind), asc(threadResource.id)),
      );
      return { meta, holds: holds.map(frozen) };
    },
    (effect, threadId) =>
      Effect.mapError(effect, (cause) =>
        cause instanceof RolloutWriterFailed ? cause : new RolloutWriterFailed({ reason: 'io', threadId, message: cause.message }),
      ),
  );

const openerId = Effect.fnUntraced(function* (row: Row | null | undefined) {
  if (row === null || row === undefined) return null;
  const { db } = yield* MachineStore;
  const identity = { harness: row.harness as string, key: row.key as string };
  const standing = yield* db
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.harness, identity.harness), eq(session.key, identity.key)))
    .get();
  if (standing !== undefined) return standing.id;
  const { id: _id, ...identityRow } = revived(row);
  const born = yield* db
    .insert(session)
    .values(identityRow as typeof session.$inferInsert)
    .returning({ id: session.id })
    .get();
  return born?.id ?? null;
});

export const importRolloutMeta = Effect.fnUntraced(function* (
  meta: unknown,
  parts: RolloutParts,
  records: ThreadRecords['Service'],
  unit: WriteUnit<'machine'>,
): Effect.fn.Return<string | null, StoreFailure, MachineStore> {
  if (meta === null || typeof meta !== 'object' || (meta as Partial<RolloutMeta>).record == null) return null;
  const read = meta as RolloutMeta;
  const { db } = yield* MachineStore;
  const record = revived(read.record);
  record.recap = carriedRecap(record.recap);
  record.createdBySessionId = yield* openerId(read.opener);
  yield* records.insert(unit, record as RecordBirth);
  if (read.mandate !== null) yield* db.insert(threadMandate).values(revived(read.mandate) as typeof threadMandate.$inferInsert);
  if (read.native !== null) yield* parts.native.write(revived(read.native));
  if (read.external !== null) yield* parts.external.write(revived(read.external));
  return record.id as string;
});
