import { Clock, Effect } from 'effect';
import type { ThreadAuthority, ThreadHistory, ThreadMetadataRow } from '@runlith/agent/thread/rows';
import type { ThreadTranscript } from '@runlith/agent/transcript/rows';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadInsertValues, ThreadPatch } from '@runlith/agent/thread/storage/aggregate';
import {
  parseThreadAuthority,
  parseThreadBornOf,
  parseThreadContextReading,
  parseThreadPendingInteraction,
  parseTransportBinding,
  parseTransportCapabilities,
  readableRowFact,
} from '@runlith/agent/thread/persisted';
import { and, eq, sql } from 'drizzle-orm';
import { programOf } from '../../platform/store/programs.js';
import { bindQuery } from '../../platform/store/queries.js';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { threadLog } from '../store/thread.js';
import { threadRolloutForm } from '../../threads/store/journal.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { metadataColumns, rowColumns, threadRow, type StoredRow } from '../row.js';
import { ThreadMetadataSource } from '../../threads/contract/service/parts.js';
import { insertBirth } from '../birth.js';
import { applyPatch } from '../patch.js';
import { restStamps } from '../../threads/rest.js';
import type { FoldWriter } from '../transcript/foldWrite.js';
import { stored, trusted, type StoredFailure } from '../../platform/store/crossing.js';
import { kernelStorageWrites } from './storageWrites.js';
import { ModelChanges } from '../../threads/contract/service/modelChanges.js';

export const EMPTY_HISTORY: ThreadHistory = [];
export const EMPTY_TRANSCRIPT: ThreadTranscript = [];

export type ThreadUnits = Effect.Success<ReturnType<typeof makeThreadUnits>>;

export const makeThreadUnits = Effect.fnUntraced(function* ({ fold }: { readonly fold: FoldWriter }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const changes = yield* ModelChanges;
  const kinds = yield* ThreadEntryKinds;
  const providers = yield* ProviderRegistry;
  const rowById = db
    .select(rowColumns)
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('id')))
    .prepare();
  const presentById = db
    .select({ id: threadRow.id })
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('id')))
    .prepare();
  const logById = db
    .select({ threadId: threadLog.threadId })
    .from(threadLog)
    .where(eq(threadLog.threadId, sql.placeholder('id')))
    .prepare();

  const foldMissing = Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
    const facet = yield* unit.run(db.select({ evictedAt: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, id)).get());
    return yield* facet?.evictedAt == null ? logMissing(id) : projectionEvicted(id);
  });

  const materialize = Effect.fnUntraced(function* (unit: Unit<'machine'>, row: StoredRow) {
    const history = yield* fold.history.read(unit, row.id);
    if (history === null) {
      const standing = yield* unit.run(presentById.get({ id: row.id }));
      return standing ? yield* foldMissing(unit, row.id) : null;
    }
    return { ...(yield* threadRowOf(kinds, row)), history };
  });

  return {
    materialize,
    apply: (unit: WriteUnit<'machine'>, id: string, patch: ThreadPatch) => applyPatch(db, records, changes, unit, id, patch),
    findIn: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
      const row = yield* unit.run(rowById.get({ id }));
      return row ? ((yield* materialize(unit, row)) ?? undefined) : undefined;
    }),
    insertRow: Effect.fnUntraced(function* (
      unit: WriteUnit<'machine'>,
      values: ThreadInsertValues & { id: string; spawnRootId: string; cacheGroup: string; authority: ThreadAuthority },
    ) {
      const { history, transcript, ...birth } = values;
      const catalog = providers.current();
      const provider = birth.provider ?? catalog.defaultModel?.provider;
      if (provider === undefined)
        return yield* new ThreadStorageFailed({ call: 'insertRow', cause: new Error('No installed adapter serves a default model.') });
      yield* insertBirth(db, records, unit, { ...birth, provider }, catalog.models);
      const log = { history: history ?? EMPTY_HISTORY, transcript: transcript ?? EMPTY_TRANSCRIPT };
      yield* unit.run(db.insert(threadLog).values({ threadId: birth.id }));
      const formedAt = new Date(yield* Clock.currentTimeMillis);
      yield* unit.run(db.insert(threadRolloutForm).values({ threadId: birth.id, formedAt, step: kinds.last }));
      yield* fold.history.seed(unit, birth.id, log.history);
      yield* fold.entries.seed(unit, birth.id, log.transcript);
      const row = yield* unit.run(rowById.get({ id: birth.id }));
      if (!row) return yield* Effect.die(new Error('Thread insert returned no row.'));
      return { ...(yield* threadRowOf(kinds, row)), history: log.history };
    }),
    required: Effect.fnUntraced(function* <A>(unit: Unit<'machine'>, id: string, load: Effect.Effect<A | null, StoredFailure>) {
      const found = yield* load;
      if (found !== null) return found;
      const row = yield* unit.run(presentById.get({ id }));
      return row === undefined ? null : yield* foldMissing(unit, id);
    }),
    hasLog: (unit: Unit<'machine'>, id: string) => Effect.map(unit.run(logById.get({ id })), (row) => row !== undefined),
    read: <A>(call: string, tx: Unit<'machine'> | undefined, work: (unit: Unit<'machine'>) => Effect.Effect<A, StoredFailure>) =>
      stored(call)(tx ? work(tx) : units.read(work)),
    write: <A>(call: string, tx: WriteUnit<'machine'> | undefined, work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, StoredFailure>) =>
      stored(call)(tx ? work(tx) : units.write(kernelStorageWrites, work)),
  };
});

export function threadRowOf<T extends ThreadMetadataRow>(kinds: ThreadEntryReader, row: T): Effect.Effect<T, ThreadStorageFailed> {
  const subject = `Thread ${row.id}`;
  return trusted<T>('threadRow', () => ({
    ...row,
    authority: parseThreadAuthority(row.authority),
    bornOf: readableRowFact(
      kinds,
      subject,
      'a birth record this build cannot read stands as none',
      () => parseThreadBornOf(row.bornOf),
      null,
    ),
    pendingInteraction: readableRowFact(
      kinds,
      subject,
      'a parked question this build cannot read stands as none, so its thread still opens and its run can be stopped',
      () => parseThreadPendingInteraction(kinds, row.pendingInteraction),
      null,
    ),
    contextReading: readableRowFact(
      kinds,
      subject,
      'a context reading this build cannot read stands as none until the next step measures it',
      () => parseThreadContextReading(kinds, row.contextReading),
      null,
    ),
    transport: parseTransportBinding(row.transport),
    capabilities: parseTransportCapabilities(row.capabilities),
  }));
}

export const makeThreadMetadata = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const metadataById = db
    .select(metadataColumns)
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('id')))
    .prepare();
  const absent = db
    .select({ id: threadRow.id })
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('id')))
    .prepare();
  const sameTransport = db
    .select({ id: threadRow.id })
    .from(threadRow)
    .where(
      and(eq(threadRow.id, sql.placeholder('id')), sql`json_extract(${threadRow.transport}, '$.adapter') is ${sql.placeholder('adapter')}`),
    )
    .prepare();
  return ThreadMetadataSource.of({
    metadata: (id, tx) => {
      const read = (unit: Unit<'machine'>) =>
        Effect.flatMap(unit.run(metadataById.get({ id })), (row) => (row ? threadRowOf(kinds, row) : Effect.succeed(undefined)));
      const program = tx === undefined ? null : programOf(tx);
      if (program === null) return stored('metadata')(tx ? read(tx) : units.read(read));
      return stored('metadata')(
        Effect.tap(units.read(read), (row) =>
          row === undefined
            ? program.guard(bindQuery(absent, { id }), 0)
            : program.guard(bindQuery(sameTransport, { id, adapter: row.transport.adapter }), 1),
        ),
      );
    },
  });
});

export function logMissing(id: string): ThreadStorageFailed {
  return new ThreadStorageFailed({ call: 'threadLog', cause: new Error(`Thread ${id} has no log row.`) });
}

export function projectionEvicted(id: string): ThreadStorageFailed {
  return new ThreadStorageFailed({
    call: 'projection-evicted',
    cause: new Error(`Thread ${id} has no projection: it was evicted to its rollout and the door that opened it read nothing back.`),
  });
}
