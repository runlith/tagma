import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { Effect, Result } from 'effect';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { entryOf, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadLog } from '../store/thread.js';
import { threadEntry } from '../../threads/store/kernel.js';
import { threadEvent, threadEventIdentity } from '../../threads/store/journal.js';
import { payloadField } from '../../threads/store/fields.js';
import { bodyInFold, foldedToolFact, toolEventIdentity } from '../../threads/journal/foldedFacts.js';

export type ThreadStripped = { readonly threadId: string; readonly events: number; readonly bytes: number };

export type StrippingReport = {
  readonly threads: readonly ThreadStripped[];
  readonly calls: number;
  readonly events: number;
  readonly bytesRemoved: number;
  readonly unidentified: number;
  readonly superseded: number;
  readonly alreadyFolded: number;
  readonly revisionChanged: number;
  readonly refused: number;
  readonly pagesFreed: number;
};

type Window = { readonly threadId: string; readonly strippedThrough: number; readonly entriesThrough: number };

type Fact = {
  readonly position: number;
  readonly entryId: string | null;
  readonly toolCallId: string | null;
  readonly runId: string | null;
};

type Outcome =
  | { readonly kind: 'folded'; readonly bytes: number }
  | { readonly kind: 'unidentified' }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'already-folded' }
  | { readonly kind: 'revision-changed' }
  | { readonly kind: 'refused' };

const UNIDENTIFIED = { kind: 'unidentified' } as const;
const SUPERSEDED = { kind: 'superseded' } as const;
const ALREADY_FOLDED = { kind: 'already-folded' } as const;
const REVISION_CHANGED = { kind: 'revision-changed' } as const;
const REFUSED = { kind: 'refused' } as const;

export const makeEventStripping = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const pending = (): Effect.Effect<readonly Window[], StoreFailure> =>
    units.read((unit) =>
      unit.run(
        store.db
          .select({
            threadId: threadLog.threadId,
            strippedThrough: threadLog.strippedThrough,
            entriesThrough: threadLog.entriesThrough,
          })
          .from(threadLog)
          .where(lt(threadLog.strippedThrough, threadLog.entriesThrough)),
      ),
    );

  const facts = (window: Window): Effect.Effect<readonly Fact[], StoreFailure> =>
    units.read((unit) =>
      unit.run(
        store.db
          .select({
            position: threadEvent.position,
            entryId: sql<string | null>`${payloadField(threadEvent.payload, 'entry.id')}`,
            toolCallId: sql<string | null>`${payloadField(threadEvent.payload, 'entry.toolCallId')}`,
            runId: sql<string | null>`${payloadField(threadEvent.payload, 'entry.runId')}`,
          })
          .from(threadEvent)
          .where(
            and(
              eq(threadEvent.threadId, window.threadId),
              gt(threadEvent.position, window.strippedThrough),
              lte(threadEvent.position, window.entriesThrough),
              eq(threadEvent.kind, 'tool'),
              sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`,
            ),
          )
          .orderBy(asc(threadEvent.position)),
      ),
    );

  const advance = (threadId: string, position: number): Effect.Effect<void, StoreFailure> =>
    units.write(writes('ThreadEventStripping.advance', [threadLog]), (unit) =>
      Effect.asVoid(
        unit.run(
          store.db
            .update(threadLog)
            .set({ strippedThrough: position })
            .where(and(eq(threadLog.threadId, threadId), lt(threadLog.strippedThrough, position))),
        ),
      ),
    );

  const latest = (threadId: string, through: number, identity: string) =>
    store.db
      .select({
        position: threadEvent.position,
        folded: sql<number | null>`case when ${bodyInFold(threadEvent.payload)} then 1 else null end`,
      })
      .from(threadEvent)
      .where(
        and(
          eq(threadEvent.threadId, threadId),
          lte(threadEvent.position, through),
          sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`,
          sql`${threadEventIdentity(threadEvent.payload)} = ${identity}`,
        ),
      )
      .orderBy(desc(threadEvent.position))
      .limit(1)
      .get();

  const factAt = (unit: Unit<'machine'>, threadId: string, position: number) =>
    unit
      .run(
        store.db
          .select({ payload: threadEvent.payload })
          .from(threadEvent)
          .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, position)))
          .get(),
      )
      .pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.succeed(undefined)
            : Effect.try({
                try: () => ({ payload: decodeThreadEventPayload(kinds, row.payload) }),
                catch: (cause) => new ThreadStorageFailed({ call: 'ThreadEventStripping.factAt', cause }),
              }),
        ),
      );

  const rowOf = (unit: Unit<'machine'>, threadId: string, entryId: string) =>
    unit
      .run(
        store.db
          .select({ entry: threadEntry.entry })
          .from(threadEntry)
          .where(and(eq(threadEntry.threadId, threadId), eq(threadEntry.entryId, entryId)))
          .get(),
      )
      .pipe(
        Effect.flatMap((row) => {
          if (row === undefined) return Effect.succeed(undefined);
          const current = kinds.stored(row.entry);
          return Result.isFailure(current)
            ? Effect.fail(new ThreadStorageFailed({ call: 'ThreadEventStripping.rowOf', cause: current.failure }))
            : Effect.succeed({ entry: current.success });
        }),
      );

  const strip = Effect.fnUntraced(function* (
    threadId: string,
    through: number,
    fact: Fact,
  ): Effect.fn.Return<Outcome, StoreFailure | ThreadStorageFailed> {
    const entryId = fact.entryId;
    const identity = toolEventIdentity(fact);
    if (entryId === null || identity === null) return UNIDENTIFIED;
    const standing = yield* units.read((unit) => unit.run(latest(threadId, through, identity)));
    if (standing === undefined || standing.position !== fact.position) return SUPERSEDED;
    if (standing.folded !== null) return ALREADY_FOLDED;
    return yield* units.write(writes('ThreadEventStripping.strip', [threadEvent]), (unit) =>
      Effect.gen(function* () {
        const held = yield* factAt(unit, threadId, standing.position);
        const row = yield* rowOf(unit, threadId, entryId);
        if (held === undefined || row === undefined) return REVISION_CHANGED;
        const body = held.payload.entry;
        if (body === undefined || !entryOf('tool')(row.entry) || !sameRevision(body, row.entry)) return REVISION_CHANGED;
        const folded = foldedToolFact(held.payload, row.entry);
        yield* unit.run(
          store.db
            .update(threadEvent)
            .set({ payload: folded })
            .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, standing.position))),
        );
        const bytes = Buffer.byteLength(JSON.stringify(held.payload), 'utf8') - Buffer.byteLength(JSON.stringify(folded), 'utf8');
        return { kind: 'folded', bytes } as const;
      }),
    );
  });

  return {
    pass: Effect.fn('ThreadEventStripping.pass')(function* () {
      const threads: ThreadStripped[] = [];
      let calls = 0;
      let events = 0;
      let bytesRemoved = 0;
      let unidentified = 0;
      let superseded = 0;
      let alreadyFolded = 0;
      let revisionChanged = 0;
      let refused = 0;
      const [, freed] = yield* store.freeing(
        Effect.gen(function* () {
          for (const window of yield* pending()) {
            let strippedEvents = 0;
            let strippedBytes = 0;
            let decided = window.strippedThrough;
            let frozen = false;
            for (const fact of yield* facts(window)) {
              calls += 1;
              const outcome = yield* strip(window.threadId, window.entriesThrough, fact).pipe(
                Effect.matchEffect({
                  onFailure: (failure) =>
                    Effect.as(
                      Effect.logWarning('a standing tool fact could not be folded', {
                        threadId: window.threadId,
                        entryId: fact.entryId,
                        reason: said(failure),
                      }),
                      REFUSED,
                    ),
                  onSuccess: Effect.succeed,
                }),
              );
              if (outcome.kind === 'refused') {
                refused += 1;
                frozen = true;
                continue;
              }
              if (!frozen) decided = fact.position;
              if (outcome.kind === 'unidentified') unidentified += 1;
              else if (outcome.kind === 'superseded') superseded += 1;
              else if (outcome.kind === 'already-folded') alreadyFolded += 1;
              else if (outcome.kind === 'revision-changed') revisionChanged += 1;
              else {
                strippedEvents += 1;
                strippedBytes += outcome.bytes;
              }
            }
            if (!frozen) decided = window.entriesThrough;
            if (decided > window.strippedThrough) yield* advance(window.threadId, decided);
            events += strippedEvents;
            bytesRemoved += strippedBytes;
            if (strippedEvents > 0) threads.push({ threadId: window.threadId, events: strippedEvents, bytes: strippedBytes });
          }
        }),
      );
      if (calls > 0) {
        yield* Effect.logInfo('standing tool facts inspected', {
          threads: threads.length,
          calls,
          events,
          bytesRemoved,
          unidentified,
          superseded,
          alreadyFolded,
          revisionChanged,
          refused,
          pagesFreed: freed,
        });
      }
      return {
        threads,
        calls,
        events,
        bytesRemoved,
        unidentified,
        superseded,
        alreadyFolded,
        revisionChanged,
        refused,
        pagesFreed: freed,
      };
    }),
  };
});

const REVISION_FIELDS = ['type', 'id', 'runId', 'toolName', 'toolCallId', 'toolState', 'occurredAt'] as const;

function sameRevision(left: ThreadTranscriptEntry, right: ThreadTranscriptEntry): boolean {
  const one = left as Record<string, unknown>;
  const other = right as Record<string, unknown>;
  return REVISION_FIELDS.every((field) => one[field] === other[field]);
}

const said = (failure: StoreFailure | ThreadStorageFailed): string =>
  (failure instanceof Error ? failure.message : String(failure)).split('\n', 1)[0]!.slice(0, 300);
