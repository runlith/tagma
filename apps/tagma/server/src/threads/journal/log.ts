import { Clock, Effect, Option } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type {
  ThreadEventInsert,
  ThreadEventPayloadValue,
  ThreadEventRevision,
  ThreadEventRow,
  ThreadRecordWindow,
} from '@runlith/agent/thread/storage/eventLog';
import { asc, and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { thread, threadEntry } from '../store/kernel.js';
import { recordFacts } from '../../thread-record/facts.js';
import { threadBase, threadEvent, threadEventIdentity } from '../store/journal.js';
import { payloadField } from '../store/fields.js';
import { foldedBody, foldedEntryId, restoredFact } from './foldedFacts.js';
import { RolloutWriterFailed, RolloutWriting } from './rolloutWriter.js';
import { RestedRollouts } from '../contract/service/rested.js';
import { conversationAppended } from './conversationIndex.js';
import { type StoredFailure, stored } from '../../platform/store/crossing.js';
import { byPosition, type EventArm, eventArmsOf, journalHead, layersOf, merged } from './base.js';

export type JournalRange = { readonly rows: readonly ThreadEventRow[]; readonly through: number; readonly missing: boolean };

export type SqliteThreadJournal = Effect.Success<typeof makeSqliteThreadJournal>;

const present = <A>(threadId: string, file: A | null): Effect.Effect<A, ThreadStorageFailed> =>
  file === null
    ? Effect.fail(
        new ThreadStorageFailed({
          call: 'rolloutReads.missing',
          cause: new Error(`Thread ${threadId} rests in its rollout, and the rollout cannot be found.`),
        }),
      )
    : Effect.succeed(file);

const keptKinds = (window: ThreadRecordWindow) => (window.kinds === undefined ? undefined : inArray(threadEvent.kind, [...window.kinds]));

const within = (window: ThreadRecordWindow) =>
  and(gt(threadEvent.position, window.afterPosition), lte(threadEvent.position, window.head), keptKinds(window));

const whole = <Row extends { readonly payload: ThreadEventPayloadValue; readonly body: ThreadTranscriptEntry | null }>(
  rows: readonly Row[],
): readonly Omit<Row, 'body'>[] =>
  rows.map(({ body, ...fact }) =>
    foldedEntryId(fact.payload) === null ? fact : { ...fact, payload: restoredFact(fact.payload, body ?? undefined) },
  );

const rested = <A>(call: string, read: Effect.Effect<A | null, StoredFailure> | undefined): Effect.Effect<A | null, ThreadStorageFailed> =>
  read === undefined
    ? Effect.succeed(null)
    : read.pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: `rolloutReads.${call}`, cause })));

export const makeSqliteThreadJournal = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const floor = Option.getOrUndefined(yield* Effect.serviceOption(RolloutWriting));
  const reads = Option.getOrUndefined(yield* Effect.serviceOption(RestedRollouts));
  const carrying = new WeakMap<WriteUnit<'machine'>, Map<string, ThreadEventRow[]>>();

  const facts = () =>
    db
      .select({
        threadId: threadEvent.threadId,
        position: threadEvent.position,
        id: threadEvent.id,
        kind: threadEvent.kind,
        payload: threadEvent.payload,
        body: threadEntry.entry,
      })
      .from(threadEvent)
      .leftJoin(threadEntry, foldedBody);

  const filed = <A>(
    threadId: string,
    tx: Unit<'machine'> | undefined,
    file: () => Effect.Effect<A, ThreadStorageFailed>,
    rows: () => Effect.Effect<A, ThreadStorageFailed>,
  ): Effect.Effect<A, ThreadStorageFailed> =>
    reads === undefined
      ? rows()
      : Effect.flatMap(
          reads.rested(threadId, tx).pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rolloutReads.rested', cause }))),
          (standing) => (standing ? file() : rows()),
        );

  const opening = Effect.fnUntraced(function* (threadId: string, held: RolloutWriting['Service']) {
    const read = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, RolloutWriterFailed | StoreFailure>) =>
      Effect.mapError(units.read(work), (cause) =>
        cause instanceof RolloutWriterFailed ? cause : new ThreadStorageFailed({ call: 'journal.open', cause }),
      );
    const facet = yield* read((unit) =>
      unit.run(
        db
          .select({
            projectId: recordFacts.projectId,
            logged: sql<number>`${journalHead(sql`${threadId}`)}`,
            floor: sql<number>`coalesce((select max(${threadBase.throughPosition}) from ${threadBase} where ${threadBase.threadId} = ${threadId}), 0)`,
          })
          .from(recordFacts)
          .where(eq(recordFacts.id, threadId))
          .get(),
      ),
    );
    const filed = yield* read((unit) => held.head(threadId, facet?.projectId ?? undefined, unit));
    if (filed === null) return yield* held.adopt(threadId, 0, []);
    const head = Math.max(filed, facet?.floor ?? 0);
    const standing = facet?.logged ?? 0;
    if (head > standing) {
      return yield* new RolloutWriterFailed({
        reason: 'ahead',
        threadId,
        message: `the rollout stands at position ${head} and the log at ${standing}; the rollout is reconciled into the log before anything more is written`,
      });
    }
    const rows =
      head === standing
        ? []
        : whole(
            yield* read((unit) =>
              unit.run(
                facts()
                  .where(and(eq(threadEvent.threadId, threadId), gt(threadEvent.position, head)))
                  .orderBy(asc(threadEvent.position)),
              ),
            ),
          );
    yield* held.adopt(threadId, head, rows);
  });

  const standingOf = (event: ThreadEventInsert, tx: WriteUnit<'machine'>) =>
    Effect.flatMap(tx.run(db.select().from(threadEvent).where(eq(threadEvent.id, event.id)).get()), (standing) =>
      standing === undefined ||
      (standing.threadId === event.threadId &&
        standing.kind === event.kind &&
        JSON.stringify(standing.payload) === JSON.stringify(event.payload))
        ? Effect.succeed(standing)
        : Effect.fail(
            new ThreadStorageFailed({ call: 'append', cause: new Error(`Thread event ${event.id} is already taken by another fact.`) }),
          ),
    );

  const carry = (row: ThreadEventRow, tx: WriteUnit<'machine'>): Effect.Effect<void> => {
    if (floor === undefined) return Effect.void;
    const batches = carrying.get(tx) ?? new Map<string, ThreadEventRow[]>();
    carrying.set(tx, batches);
    const batch = batches.get(row.threadId);
    if (batch !== undefined && batch[batch.length - 1]!.position + 1 === row.position) {
      batch.push(row);
      return Effect.void;
    }
    const rows = [row];
    batches.set(row.threadId, rows);
    return tx.afterCommit(Effect.orDie(floor.carry(row.threadId, rows)));
  };

  const rangeFrom = Effect.fnUntraced(function* (
    threadId: string,
    window: ThreadRecordWindow,
    tx: Unit<'machine'> | undefined,
    low: number | null,
    inUnit: <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, StoreFailure>) => Effect.Effect<A, ThreadStorageFailed>,
    logged: (unit: Unit<'machine'>, from: number) => Effect.Effect<readonly ThreadEventRow[], StoreFailure>,
  ) {
    const covered = (rows: readonly ThreadEventRow[]): JournalRange => ({
      rows,
      through: rows.length < window.limit ? window.head : rows[rows.length - 1]!.position,
      missing: false,
    });
    if (low !== null && window.afterPosition + 1 >= low) return covered(yield* inUnit((unit) => logged(unit, window.afterPosition)));
    const upto = low === null ? window.head : Math.min(window.head, low - 1);
    if (upto <= window.afterPosition) return { rows: [], through: window.afterPosition, missing: false };
    const file = yield* rested('range', reads?.range(threadId, { ...window, head: upto }, tx));
    if (file === null) return { rows: [], through: window.afterPosition, missing: true };
    if (file.rows.length >= window.limit) return { rows: file.rows, through: file.through, missing: false };
    if (file.through < upto) return { rows: file.rows, through: file.through, missing: true };
    if (low === null) return covered(file.rows);
    const rest = yield* inUnit((unit) => logged(unit, low - 1));
    return covered([...file.rows, ...rest].slice(0, window.limit));
  });

  const range = (threadId: string, window: ThreadRecordWindow, tx?: Unit<'machine'>): Effect.Effect<JournalRange, ThreadStorageFailed> => {
    const logged = (unit: Unit<'machine'>, from: number): Effect.Effect<readonly ThreadEventRow[], StoreFailure> =>
      Effect.flatMap(layersOf(db, unit, threadId), (layers) =>
        Effect.map(
          unit.run(
            byPosition(eventArmsOf(threadId, layers), (where) =>
              facts()
                .where(and(where, within({ ...window, afterPosition: from })))
                .$dynamic(),
            ).limit(window.limit),
          ),
          (rows) => whole(rows).map((row) => ({ ...row, threadId })),
        ),
      );
    const inUnit = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, StoreFailure>): Effect.Effect<A, ThreadStorageFailed> =>
      stored('recordsAsOf')(tx ? work(tx) : units.read(work));
    const lowest = inUnit((unit) =>
      Effect.flatMap(layersOf(db, unit, threadId), (layers) =>
        Effect.map(
          unit.run(
            byPosition(eventArmsOf(threadId, layers), (where) =>
              db.select({ position: threadEvent.position }).from(threadEvent).where(where).$dynamic(),
            )
              .limit(1)
              .get(),
          ),
          (first) => first?.position ?? null,
        ),
      ),
    );
    return filed(
      threadId,
      tx,
      () => rangeFrom(threadId, window, tx, null, inUnit, logged),
      () => Effect.flatMap(lowest, (low) => rangeFrom(threadId, window, tx, low, inUnit, logged)),
    );
  };

  const open = Effect.fn('ThreadJournal.open')(function* (threadId: string, held: RolloutWriting['Service']) {
    yield* Effect.annotateCurrentSpan({ threadId });
    const opened = yield* Effect.result(opening(threadId, held));
    if (opened._tag === 'Success') return;
    if (opened.failure instanceof RolloutWriterFailed) return held.refuse(threadId, opened.failure);
    return yield* opened.failure;
  });

  const append = Effect.fn('ThreadStorage.append')(function* (event: ThreadEventInsert, tx: WriteUnit<'machine'>) {
    yield* Effect.annotateCurrentSpan({ threadId: event.threadId, events: 1 });
    const refusal = floor?.refusal(event.threadId);
    if (refusal !== undefined) {
      const standing = yield* standingOf(event, tx);
      return standing ?? (yield* new ThreadStorageFailed({ call: 'floor.open', cause: refusal }));
    }
    const row = yield* tx.run(
      db
        .insert(threadEvent)
        .values({
          threadId: event.threadId,
          id: event.id,
          kind: event.kind,
          payload: event.payload,
          position: sql<number>`(${journalHead(sql`${event.threadId}`)} + 1)`,
        })
        .onConflictDoNothing()
        .returning({ position: threadEvent.position })
        .get(),
    );
    if (row === undefined) {
      const standing = yield* standingOf(event, tx);
      return standing ?? (yield* Effect.die(new Error(`Thread event ${event.id} insert returned no row.`)));
    }
    const held = floor?.held(event.threadId);
    if (held !== undefined && row.position <= held) {
      return yield* new ThreadStorageFailed({
        call: 'floor.carry',
        cause: new RolloutWriterFailed({
          reason: 'ahead',
          threadId: event.threadId,
          message: `the rollout already holds position ${row.position}, so the log stands behind its journal`,
        }),
      });
    }
    const appended = { threadId: event.threadId, position: row.position, id: event.id, kind: event.kind, payload: event.payload };
    yield* tx.run(
      db
        .update(thread)
        .set({ updatedAt: new Date(yield* Clock.currentTimeMillis) })
        .where(eq(thread.id, event.threadId)),
    );
    yield* conversationAppended(db, tx, event.threadId, appended);
    yield* carry(appended, tx);
    return appended;
  });

  return {
    open: (threadId: string): Effect.Effect<void, ThreadStorageFailed> =>
      floor === undefined || !floor.unopened(threadId) ? Effect.void : open(threadId, floor),
    append: (event: ThreadEventInsert, tx: WriteUnit<'machine'>) => stored('append')(append(event, tx)),

    eventsAfter: (threadId: string, afterPosition: number, limit: number, tx?: Unit<'machine'>) => {
      const work = (unit: Unit<'machine'>): Effect.Effect<readonly ThreadEventRow[], StoreFailure> =>
        Effect.flatMap(layersOf(db, unit, threadId), (layers) =>
          Effect.map(
            unit.run(
              byPosition(eventArmsOf(threadId, layers), (where) =>
                facts()
                  .where(and(where, gt(threadEvent.position, afterPosition)))
                  .$dynamic(),
              ).limit(limit),
            ),
            (rows) => whole(rows).map((row) => ({ ...row, threadId })),
          ),
        );
      return filed(
        threadId,
        tx,
        () =>
          Effect.flatMap(rested('events', reads?.events(threadId, { head: Number.MAX_SAFE_INTEGER, afterPosition, limit }, tx)), (file) =>
            present(threadId, file),
          ),
        () => stored('eventsAfter')(tx ? work(tx) : units.read(work)),
      );
    },

    recordsAsOf: (threadId: string, window: ThreadRecordWindow, tx?: Unit<'machine'>) =>
      Effect.map(range(threadId, window, tx), (read) => read.rows),

    range,

    revisionsAsOf: (threadId: string, window: ThreadRecordWindow, tx?: Unit<'machine'>) => {
      const identity = threadEventIdentity(threadEvent.payload);
      const lastIn = (arm: EventArm) => sql`not exists (
            select 1 from ${threadEvent} as later
             where ${arm.on(sql`later.thread_id`, sql`later.position`)}
               and later.position > ${threadEvent.position}
               and later.position <= ${window.head}
               and ${payloadField(sql`later.payload`, 'entry.id')} is not null
               and ${threadEventIdentity(sql`later.payload`)} = ${identity}
          )`;
      const latest = (arms: readonly [EventArm, ...EventArm[]]) =>
        byPosition(arms, (where) =>
          db
            .select({
              threadId: threadEvent.threadId,
              position: threadEvent.position,
              id: threadEvent.id,
              kind: threadEvent.kind,
              payload: threadEvent.payload,
              body: threadEntry.entry,
              identity: sql<string>`${identity}`.as('identity'),
            })
            .from(threadEvent)
            .leftJoin(threadEntry, foldedBody)
            .where(and(where, within(window), sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`, ...arms.map(lastIn)))
            .$dynamic(),
        ).limit(window.limit);
      const work = (unit: Unit<'machine'>): Effect.Effect<readonly ThreadEventRevision[], StoreFailure> =>
        Effect.flatMap(layersOf(db, unit, threadId), (layers) =>
          Effect.map(unit.run(latest(eventArmsOf(threadId, layers))), (rows) => whole(rows).map((row) => ({ ...row, threadId }))),
        );
      return filed(
        threadId,
        tx,
        () => Effect.flatMap(rested('revisions', reads?.revisions(threadId, window, tx)), (file) => present(threadId, file)),
        () => stored('revisionsAsOf')(tx ? work(tx) : units.read(work)),
      );
    },

    positionOf: (threadId: string, recordId: string, tx?: Unit<'machine'>) => {
      const work = (unit: Unit<'machine'>): Effect.Effect<number | null, StoreFailure> =>
        Effect.flatMap(layersOf(db, unit, threadId), (layers) =>
          Effect.map(
            unit.run(
              merged(eventArmsOf(threadId, layers), (where) =>
                db
                  .select({
                    position: threadEvent.position,
                    named: sql<number>`case when ${threadEvent.id} = ${recordId} then 1 else 0 end`.as('named'),
                  })
                  .from(threadEvent)
                  .where(
                    and(
                      where,
                      sql`(${threadEvent.id} = ${recordId} or ${payloadField(threadEvent.payload, 'entry.id')} = ${recordId} or ${threadEventIdentity(threadEvent.payload)} = ${recordId})`,
                    ),
                  )
                  .$dynamic(),
              )
                .orderBy(desc(sql`named`), desc(threadEvent.position))
                .limit(1)
                .get(),
            ),
            (row) => row?.position ?? null,
          ),
        );
      return filed(
        threadId,
        tx,
        () => rested('position', reads?.position(threadId, recordId, tx)),
        () => stored('positionOf')(tx ? work(tx) : units.read(work)),
      );
    },

    headPosition: (threadId: string, tx?: Unit<'machine'>) => {
      const work = (unit: Unit<'machine'>): Effect.Effect<number, StoreFailure> =>
        Effect.map(unit.run(db.get<{ head: number }>(sql`select ${journalHead(sql`${threadId}`)} as head`)), (row) => row?.head ?? 0);
      return filed(
        threadId,
        tx,
        () => Effect.map(rested('head', reads?.head(threadId, tx)), (file) => file ?? 0),
        () => stored('headPosition')(tx ? work(tx) : units.read(work)),
      );
    },
  };
});
