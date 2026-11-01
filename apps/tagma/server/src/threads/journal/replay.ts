import { Effect } from 'effect';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { WorkerUnavailable } from '@runlith/utils/worker';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { recordRows } from '../../thread-record/store/table.js';
import { setRested } from '../rest.js';
import { mandateRows } from '../store/mandate.js';
import { session } from '../../platform/store/writers.js';
import { basename, dirname } from 'node:path';
import {
  conversationWrites,
  publishedSourceRows,
  threadBase,
  threadEvent,
  threadJournalPlace,
  threadPublishedSource,
  threadRolloutCursor,
} from '../store/journal.js';
import type { SourcePublication } from './sourceFiles.js';
import { threadResource } from '../store/tables.js';
import { type FoldRow, importRolloutMeta, type NativeFolds, type RolloutMeta, type RolloutParts } from './rolloutMeta.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { RolloutUnreadable, appendRolloutItem } from './rolloutFile.js';
import { RolloutSyncRefused } from './export.js';
import { threadEntry } from '../store/kernel.js';
import { foldedBody, foldedEntryId, restoredFact } from './foldedFacts.js';
import { dropJournal } from './rest.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { conversationCarried, speaks } from './conversationIndex.js';
import { rolloutFiles } from './rolloutForms.js';
import type { CarryAsk, Carrying } from './rolloutCarry.js';

const EVENT_INSERT_ROWS = 2_000;

type Planned = Extract<Carrying, { readonly kind: 'planned' }>;
type Opened = Extract<Carrying, { readonly kind: 'absent' }> | Planned;

const unreadableAt =
  (path: string) =>
  (failure: RolloutUnreadable | WorkerUnavailable): RolloutUnreadable =>
    failure instanceof WorkerUnavailable ? new RolloutUnreadable({ reason: 'io', path, message: failure.message }) : failure;

const carried = (
  folds: NativeFolds,
  path: string,
  ask: CarryAsk,
): Effect.Effect<Opened, RolloutUnreadable | RolloutSyncRefused, ThreadEntryKinds> =>
  folds.carry(rolloutFiles(path), ask).pipe(
    Effect.mapError(unreadableAt(path)),
    Effect.flatMap((opening): Effect.Effect<Opened, RolloutSyncRefused> => {
      if (opening.kind === 'refused') return Effect.fail(new RolloutSyncRefused({ reason: opening.reason, message: opening.message }));
      return Effect.succeed(opening);
    }),
  );

const planned =
  (path: string) =>
  (opening: Opened): Effect.Effect<Planned, RolloutSyncRefused> =>
    opening.kind === 'planned'
      ? Effect.succeed(opening)
      : Effect.fail(
          new RolloutSyncRefused({
            reason: 'record-shape',
            message: `the rollout ${path} lacks ${opening.absent.length} event(s) that stand in the database`,
          }),
        );

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

const carryThreadRecords = Effect.fnUntraced(function* (threadId: string, plan: Planned, parts: RolloutParts, unit: WriteUnit<'machine'>) {
  const { db } = yield* MachineStore;
  const native = plan.native ? parts.native.folds : null;
  for (let at = 0; at < plan.units; at += 1) yield* writeBatch(threadId, yield* plan.take(at), native, unit);
  if (native !== null) yield* native.settle(threadId, plan.through);
  const cursor = { nextByteOffset: plan.bytes, nextPosition: plan.through + 1 };
  yield* db
    .insert(threadRolloutCursor)
    .values({ threadId, ...cursor })
    .onConflictDoUpdate({ target: threadRolloutCursor.threadId, set: cursor });
});

const keptInFile = Effect.fn('ThreadRollout.rehydrate.keep')(function* (
  threadId: string,
  path: string,
  folds: NativeFolds,
  native: boolean,
) {
  const store = yield* MachineStore;
  const { db } = store;
  const standing = yield* db
    .select({ position: threadEvent.position, id: threadEvent.id })
    .from(threadEvent)
    .where(eq(threadEvent.threadId, threadId))
    .orderBy(asc(threadEvent.position));
  const published = yield* db
    .select({ bytes: threadPublishedSource.bytes, fingerprint: threadPublishedSource.fingerprint })
    .from(threadPublishedSource)
    .where(eq(threadPublishedSource.threadId, threadId))
    .get();
  const ask: CarryAsk = {
    threadId,
    native,
    standing: standing.map((row) => row.id),
    sources: null,
    ...(published === undefined ? {} : { published }),
  };
  const floor =
    (yield* db
      .select({ reached: threadRolloutCursor.nextPosition })
      .from(threadRolloutCursor)
      .where(eq(threadRolloutCursor.threadId, threadId))
      .get())?.reached ?? 1;
  const whole = (plan: Planned): Effect.Effect<Planned, RolloutSyncRefused> =>
    plan.through + 1 >= floor
      ? Effect.succeed(plan)
      : Effect.andThen(
          plan.drop,
          Effect.fail(
            new RolloutSyncRefused({
              reason: 'record-shape',
              message: `the rollout ${path} ends at position ${plan.through}, before position ${floor - 1} its rows consumed, so it does not return`,
            }),
          ),
        );
  const first = yield* carried(folds, path, ask);
  if (first.kind === 'planned') return yield* whole(first);
  const absent = new Set(first.absent);
  const positions = standing.filter((row) => absent.has(row.id)).map((row) => row.position);
  let last = first.last;
  for (let at = 0; at < positions.length; at += KEPT_ROWS) {
    yield* keepRows(threadId, path, positions.slice(at, at + KEPT_ROWS), last);
    last += Math.min(KEPT_ROWS, positions.length - at);
  }
  const kept = yield* Effect.flatMap(Effect.flatMap(carried(folds, path, ask), planned(path)), whole);
  const key = { nextByteOffset: kept.bytes, nextPosition: last + 1 };
  yield* store
    .transaction(writes('thread.rehydrate.keep', [threadRolloutCursor]), (unit) =>
      Effect.asVoid(unit.run(db.update(threadRolloutCursor).set(key).where(eq(threadRolloutCursor.threadId, threadId)))),
    )
    .pipe(Effect.onError(() => kept.drop));
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

type RehydrateInput = { readonly threadId: string; readonly path: string; readonly parts: RolloutParts };

export const rehydrateThreadRecords = Effect.fn('ThreadRollout.rehydrate.carry')(function* (
  input: RehydrateInput,
  publication: SourcePublication,
) {
  yield* Effect.annotateCurrentSpan({ threadId: input.threadId });
  const store = yield* MachineStore;
  const { db } = store;
  const folds = input.parts.native.folds;
  const native = yield* folds.present(input.threadId);
  const plan = yield* keptInFile(input.threadId, input.path, folds, native);
  yield* Effect.gen(function* () {
    yield* store.transaction(writes('thread.rehydrate.release', [], folds.writes), () => folds.release(input.threadId));
    yield* dropJournal(input.threadId, folds, false);
    const retained =
      (yield* db.select({ ord: threadEntry.ord }).from(threadEntry).where(eq(threadEntry.threadId, input.threadId)).limit(1).get()) !==
      undefined;
    for (let at = 0; at < plan.units; at += 1) {
      const batch = yield* plan.take(at);
      yield* store.transaction(writes('thread.rehydrate.rows', [threadEvent], folds.writes, conversationWrites), (unit) =>
        writeBatch(input.threadId, batch, native ? folds : null, unit, retained),
      );
    }
    yield* store.transaction(writes('thread.rehydrate.finish', [threadRolloutCursor, publishedSourceRows], folds.writes), (unit) =>
      Effect.gen(function* () {
        if (native) yield* folds.settle(input.threadId, plan.through);
        yield* db
          .insert(threadRolloutCursor)
          .values({ threadId: input.threadId, nextByteOffset: plan.bytes, nextPosition: plan.through + 1 })
          .onConflictDoUpdate({
            target: threadRolloutCursor.threadId,
            set: { nextByteOffset: plan.bytes, nextPosition: plan.through + 1 },
          });
        yield* publication.withdrawIn(db, unit, input.threadId, input.path);
        yield* setRested(db, unit, input.threadId, null);
      }),
    );
  }).pipe(Effect.ensuring(plan.drop));
  yield* Effect.annotateCurrentSpan({ records: plan.records, units: plan.units + 2 });
});

export type RolloutSources = ReadonlyMap<string, string>;

export const rolloutBase = (path: string, folds: NativeFolds) => Effect.mapError(folds.layers(rolloutFiles(path)), unreadableAt(path));

export const replayThreadRollout = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly parts: RolloutParts;
  readonly records: ThreadRecords['Service'];
  readonly sources?: RolloutSources;
}) {
  const store = yield* MachineStore;
  const { db } = store;
  const sources = [...(input.sources ?? new Map<string, string>())].map(([sourceId, path]) => ({ sourceId, path }));
  const plan = yield* Effect.flatMap(
    carried(input.parts.native.folds, input.path, { threadId: null, native: null, standing: [], sources }),
    planned(input.path),
  );
  const meta = plan.meta as Partial<RolloutMeta> | null;
  const base = meta?.base ?? [];
  const journal = Number(basename(dirname(input.path)));
  const threadId = yield* store
    .transaction(
      writes(
        'thread.rollout',
        [recordRows, mandateRows, session, threadEvent, threadRolloutCursor, threadResource, threadBase, threadJournalPlace],
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
          if (plan.inherited > 0) {
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
          yield* carryThreadRecords(id, plan, input.parts, unit);
          for (const hold of plan.holds) yield* db.insert(threadResource).values(hold as typeof threadResource.$inferInsert);
          return id;
        }),
    )
    .pipe(Effect.ensuring(plan.drop));
  if (threadId === null) {
    return yield* new RolloutSyncRefused({ reason: 'record-shape', message: 'the meta line carries no record' });
  }
  return { threadId, inherited: plan.inherited };
});
