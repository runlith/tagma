import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Data, Effect, Result } from 'effect';
import { and, asc, eq, gt } from 'drizzle-orm';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import {
  conversationWrites,
  publishedSourceRows,
  threadBase,
  threadEvent,
  threadPublishedSource,
  threadRolloutCursor,
  threadRolloutForm,
} from '../store/journal.js';
import { type BaseLayer, byPosition, eventArmsOf } from './base.js';
import { threadResource } from '../store/tables.js';
import { foldedEntryId, restoredFact } from './foldedFacts.js';
import {
  fingerprintedPayload,
  frozen,
  revived,
  sourceEventText,
  sourceRecordsText,
  type Row,
  type RolloutParts,
  type SourceCheckpoint,
  threadRolloutMeta,
} from './rolloutMeta.js';
import { RolloutUnreadable, appendRolloutItems, createRollout } from './rolloutFile.js';
import { rolloutReplaced } from './rolloutGeneration.js';
import type { SourcePublication } from './sourceFiles.js';
import type { SourceReplacement } from './sourceReplacement.js';

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

export const sourceFactFingerprint = Effect.fn('ThreadRollout.sourceFactFingerprint')(function* (input: {
  readonly threadId: string;
  readonly parts: RolloutParts;
  readonly prefix: boolean;
}) {
  const { db } = yield* MachineStore;
  const kinds = yield* ThreadEntryKinds;
  const layers = input.prefix
    ? yield* db.select().from(threadBase).where(eq(threadBase.threadId, input.threadId)).orderBy(asc(threadBase.depth))
    : [];
  const hash = createHash('sha256');
  let position = 0;
  while (true) {
    const events = yield* factsOfThread(db, input.threadId, layers, position, input.parts, PAGE);
    for (const event of events) {
      const whole = yield* wholeFact(event);
      const payload = fingerprintedPayload(kinds, whole.payload);
      hash.update(sourceEventText({ position: event.fact.position, id: event.fact.id, kind: event.fact.kind, payload }));
    }
    position = events.at(-1)?.fact.position ?? position;
    if (events.length < PAGE) break;
  }
  const held = yield* input.parts.native.folds.held(input.threadId);
  hash.update(
    sourceRecordsText(
      held.checkpoints.map((row) => revived(row) as SourceCheckpoint),
      held.pruned.map((row) => [row.toolCallId as string, row.tokens as number] as const),
    ),
  );
  return hash.digest('hex');
});

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

type ExportInput = {
  readonly threadId: string;
  readonly path: string;
  readonly parts: RolloutParts;
  readonly prefix?: boolean;
};

const exported = writes('ThreadRollout.exported', [threadRolloutCursor, threadRolloutForm, publishedSourceRows], conversationWrites);

const restedIn = Effect.fnUntraced(function* (db: StoreDb<'machine'>, threadId: string, unit?: Unit<'machine'>) {
  const query = db
    .select({ at: threadRolloutCursor.restedAt })
    .from(threadRolloutCursor)
    .where(eq(threadRolloutCursor.threadId, threadId))
    .get();
  return ((yield* unit === undefined ? query : unit.run(query))?.at ?? null) !== null;
});

const restedRefusal = (threadId: string) =>
  new RolloutSyncRefused({
    reason: 'record-shape',
    message: `thread ${threadId} rests on its journal, so its rows cannot rewrite it; it returns before it is exported`,
  });

export const exportThreadRollout = Effect.fn('ThreadRollout.export')(
  function* (input: ExportInput, publication: SourcePublication, replacement: SourceReplacement) {
    yield* Effect.annotateCurrentSpan({ threadId: input.threadId });
    const { db } = yield* MachineStore;
    yield* replacement.settle(input.threadId, input.path);
    const meta = yield* threadRolloutMeta(input.threadId, input.parts);
    if (meta === null) {
      return yield* Effect.fail(new RolloutSyncRefused({ reason: 'thread-missing', message: `thread ${input.threadId} has no row` }));
    }
    if (yield* restedIn(db, input.threadId)) return yield* restedRefusal(input.threadId);
    const partial = `${input.path}.partial`;
    yield* Effect.promise(() => rm(partial, { force: true })).pipe(Effect.uninterruptible);
    yield* createRollout(partial, input.prefix === true ? { ...meta, base: [] } : meta).pipe(Effect.uninterruptible);
    const prior = yield* db.select().from(threadPublishedSource).where(eq(threadPublishedSource.threadId, input.threadId)).get();
    const form = yield* db
      .select({ step: threadRolloutForm.step })
      .from(threadRolloutForm)
      .where(eq(threadRolloutForm.threadId, input.threadId))
      .get();
    const built = yield* Effect.gen(function* () {
      const written = yield* writtenWhole(db, input, partial);
      const digest = yield* publication.digest(partial);
      const source =
        prior === undefined
          ? null
          : yield* publication.stage({
              canonical: input.path,
              candidate: { kind: 'staged', path: partial, representation: 'plain', replaces: true },
              form: form?.step ?? null,
              origin: 'export',
            });
      if (source !== null && source.fingerprint !== digest) {
        yield* publication.discard(input.threadId, input.path, source);
        return yield* new RolloutUnreadable({ reason: 'io', path: partial, message: 'the staged source changed during publication' });
      }
      return { written, source, digest };
    }).pipe(Effect.onError(() => Effect.promise(() => rm(partial, { force: true }))));
    yield* replacement
      .replace(
        { threadId: input.threadId, canonical: input.path, staged: partial, target: 'plain', digest: built.digest },
        exported,
        (unit) =>
          Effect.gen(function* () {
            if (yield* restedIn(db, input.threadId, unit)) return yield* restedRefusal(input.threadId);
            yield* rolloutReplaced(db, unit, input.threadId, input.path);
            if (built.source !== null) yield* publication.publishIn(db, unit, input.threadId, input.path, built.source);
          }),
      )
      .pipe(
        Effect.onError(() =>
          Effect.suspend(() => {
            if (replacement.pending(input.threadId)) return Effect.void;
            return Effect.gen(function* () {
              const current = yield* db
                .select()
                .from(threadPublishedSource)
                .where(eq(threadPublishedSource.threadId, input.threadId))
                .get();
              if (built.source !== null && current?.generation !== built.source.generation)
                yield* publication.discard(input.threadId, input.path, built.source);
              yield* Effect.promise(() => rm(partial, { force: true }));
            }).pipe(Effect.catchCause((cause) => Effect.logError(`The staged rollout of ${input.threadId} could not be removed`, cause)));
          }),
        ),
        Effect.uninterruptible,
      );
    return built.written;
  },
  (effect, input) =>
    effect.pipe(
      Effect.catchTag('WorkerUnavailable', (cause) =>
        Effect.fail(new RolloutUnreadable({ reason: 'io', path: input.path, message: cause.message })),
      ),
    ),
);

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
