import { rename, rm } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import { and, asc, eq, gt } from 'drizzle-orm';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import { threadBase, threadEvent } from '../store/journal.js';
import { type BaseLayer, byPosition, eventArmsOf } from './base.js';
import { threadResource } from '../store/tables.js';
import { foldedEntryId, restoredFact } from './foldedFacts.js';
import { frozen, type Row, type RolloutParts, threadRolloutMeta } from './rolloutMeta.js';
import { RolloutUnreadable, appendRolloutItems, createRollout, scanRollout } from './rolloutFile.js';
import { rolloutReplaced } from './rolloutGeneration.js';

export class RolloutSyncRefused extends Data.TaggedError('RolloutSyncRefused')<{
  readonly reason: 'thread-missing' | 'record-shape';
  readonly message: string;
}> {}

type Fact = { threadId: string; position: number; id: string; kind: string; payload: ThreadEventPayloadValue };

//! One page is what the loop parses and encodes at once, so a whole journal never lands on it in one pass.
const PAGE = 128;

const factsOfThread = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  layers: readonly BaseLayer[],
  after: number,
  parts: RolloutParts,
  limit?: number,
) {
  const ordered = byPosition(eventArmsOf(threadId, layers), (where) =>
    db
      .select({
        threadId: threadEvent.threadId,
        position: threadEvent.position,
        id: threadEvent.id,
        kind: threadEvent.kind,
        payload: threadEvent.payload,
      })
      .from(threadEvent)
      .where(and(where, gt(threadEvent.position, after)))
      .$dynamic(),
  );
  const facts = yield* limit === undefined ? ordered : ordered.limit(limit);
  const folded = facts.flatMap((fact) => foldedEntryId(fact.payload) ?? []);
  const bodies = new Map(yield* parts.native.folds.bodies(threadId, folded));
  for (const sourceId of new Set(facts.flatMap((fact) => (fact.threadId === threadId ? [] : [fact.threadId])))) {
    const missing = facts.flatMap((fact) => {
      const entryId = fact.threadId === sourceId ? foldedEntryId(fact.payload) : null;
      return entryId === null || bodies.has(entryId) ? [] : [entryId];
    });
    for (const [entryId, body] of yield* parts.native.folds.bodies(sourceId, missing)) bodies.set(entryId, body);
  }
  return facts.map((fact): { readonly fact: Fact; readonly body: unknown } => {
    const entryId = foldedEntryId(fact.payload);
    const own = fact.threadId === threadId ? fact : { ...fact, threadId, id: `${threadId}:${fact.position}` };
    return { fact: own, body: entryId === null ? null : (bodies.get(entryId) ?? null) };
  });
});

function wholeFact({ fact: row, body }: { readonly fact: Fact; readonly body: unknown }): Effect.Effect<Row, RolloutSyncRefused> {
  const { payload, ...columns } = row;
  const entryId = foldedEntryId(payload);
  if (entryId !== null && body === null) {
    return Effect.fail(
      new RolloutSyncRefused({
        reason: 'record-shape',
        message: `folded event ${row.id} at position ${row.position} names entry ${entryId} but its body row is missing`,
      }),
    );
  }
  return Effect.succeed({
    ...columns,
    payload: entryId === null ? payload : restoredFact(payload, body),
  });
}

const eventRecords = (rows: readonly Row[]) => rows.map((row) => ({ kind: 'event', row: frozen(row) }));

export const appendThreadRollout = Effect.fnUntraced(function* (input: {
  readonly threadId: string;
  readonly path: string;
  readonly after: number;
  readonly parts: RolloutParts;
}) {
  const { db } = yield* MachineStore;
  const events = yield* factsOfThread(db, input.threadId, [], input.after, input.parts);
  const rows = yield* Effect.forEach(events, wholeFact);
  if (rows.length > 0) yield* appendRolloutItems(input.path, eventRecords(rows));
  return { records: events.length, through: events.at(-1)?.fact.position ?? input.after };
});

export const exportThreadRollout = Effect.fn('ThreadRollout.export')(function* (input: {
  readonly threadId: string;
  readonly path: string;
  readonly parts: RolloutParts;
  readonly prefix?: boolean;
}) {
  yield* Effect.annotateCurrentSpan({ threadId: input.threadId });
  const { db } = yield* MachineStore;
  const meta = yield* threadRolloutMeta(input.threadId, input.parts);
  if (meta === null) {
    return yield* Effect.fail(new RolloutSyncRefused({ reason: 'thread-missing', message: `thread ${input.threadId} has no row` }));
  }
  const partial = `${input.path}.partial`;
  yield* Effect.promise(() => rm(partial, { force: true })).pipe(Effect.uninterruptible);
  yield* createRollout(partial, input.prefix === true ? { ...meta, base: [] } : meta).pipe(Effect.uninterruptible);
  const written = yield* writtenWhole(db, input, partial).pipe(Effect.onError(() => Effect.promise(() => rm(partial, { force: true }))));
  yield* Effect.gen(function* () {
    yield* rolloutReplaced(yield* MachineStore, input.threadId, input.path);
    yield* Effect.tryPromise({
      try: () => rename(partial, input.path),
      catch: (error) =>
        new RolloutUnreadable({ reason: 'io', path: input.path, message: error instanceof Error ? error.message : String(error) }),
    });
  }).pipe(
    Effect.onError(() => Effect.promise(() => rm(partial, { force: true }))),
    Effect.uninterruptible,
  );
  return written;
});

const writtenWhole = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  input: { readonly threadId: string; readonly parts: RolloutParts; readonly prefix?: boolean },
  partial: string,
) {
  const holds = yield* db
    .select()
    .from(threadResource)
    .where(eq(threadResource.threadId, input.threadId))
    .orderBy(asc(threadResource.kind), asc(threadResource.id));
  let records = yield* appendRolloutItems(
    partial,
    holds.map((row) => ({ kind: 'hold', row: frozen(row) })),
  ).pipe(Effect.uninterruptible);
  let through = 0;
  const layers =
    input.prefix === true
      ? yield* db.select().from(threadBase).where(eq(threadBase.threadId, input.threadId)).orderBy(asc(threadBase.depth))
      : [];
  while (true) {
    const events = yield* factsOfThread(db, input.threadId, layers, through, input.parts, PAGE);
    const rows = yield* Effect.forEach(events, wholeFact);
    records += yield* appendRolloutItems(partial, eventRecords(rows)).pipe(Effect.uninterruptible);
    through = events.at(-1)?.fact.position ?? through;
    if (events.length < PAGE) break;
  }
  const held = yield* input.parts.native.folds.held(input.threadId);
  records += yield* appendRolloutItems(partial, [
    ...held.checkpoints.map((row) => ({ kind: 'checkpoint', row })),
    ...held.pruned.map((row) => ({ kind: 'pruned', row })),
  ]).pipe(Effect.uninterruptible);
  yield* Effect.annotateCurrentSpan({ events: through, records });
  return { records, through };
});
