import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadLog } from '../store/thread.js';
import { threadBase, threadEvent } from '../../threads/store/journal.js';
import { foldedFootprint, footprintTools, toolsInFootprint } from '../../threads/journal/foldedFacts.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

export type ThreadFolded = { readonly threadId: string; readonly measurements: number; readonly bytes: number };

export type FootprintReport = {
  readonly threads: readonly ThreadFolded[];
  readonly seen: number;
  readonly folded: number;
  readonly bytesRemoved: number;
  readonly newest: number;
  readonly refused: number;
  readonly remaining: number;
  readonly pagesFreed: number;
};

type Window = { readonly threadId: string; readonly foldedThrough: number };

type Standing = { readonly position: number; readonly payload: ThreadEventPayloadValue };

type Folded = {
  readonly folded: number;
  readonly bytes: number;
  readonly refused: number;
  readonly decided: number;
  readonly frozen: boolean;
};

const NOTHING_FOLDED: Folded = { folded: 0, bytes: 0, refused: 0, decided: 0, frozen: false };

const PASS_BUDGET = 50_000;

const ROWS_PER_UNIT = 200;

export const ROWS_PER_READ = 5 * ROWS_PER_UNIT;

export const makeFootprintFolding = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const pending = (): Effect.Effect<readonly Window[], StoreFailure> =>
    units.read((unit) =>
      unit.run(
        store.db
          .select({ threadId: threadLog.threadId, foldedThrough: threadLog.footprintsThrough })
          .from(threadLog)
          .where(
            sql`exists (select 1 from ${threadEvent} where ${threadEvent.threadId} = ${threadLog.threadId}
              and ${threadEvent.position} > ${threadLog.footprintsThrough}
              and ${threadEvent.kind} = 'measurement' and ${toolsInFootprint(threadEvent.payload)})`,
          )
          .orderBy(asc(threadLog.threadId)),
      ),
    );

  const unfolded = (window: Window) =>
    and(
      eq(threadEvent.threadId, window.threadId),
      gt(threadEvent.position, window.foldedThrough),
      eq(threadEvent.kind, 'measurement'),
      toolsInFootprint(threadEvent.payload),
      sql`not exists (select 1 from ${threadBase} where ${threadBase.sourceId} = ${window.threadId}
        and ${threadEvent.position} = (select max(newest.position) from ${threadEvent} as newest
          where newest.thread_id = ${window.threadId} and newest.position <= ${threadBase.throughPosition}
            and newest.kind = 'measurement' and ${toolsInFootprint(sql`newest.payload`)}))`,
    );

  const standing = (window: Window, limit: number): Effect.Effect<readonly Standing[], StoreFailure> =>
    units.read((unit) =>
      unit.run(
        store.db
          .select({ position: threadEvent.position, payload: threadEvent.payload })
          .from(threadEvent)
          .where(unfolded(window))
          .orderBy(asc(threadEvent.position))
          .limit(limit),
      ),
    );

  const foldable = (window: Window): Effect.Effect<number, StoreFailure> =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          store.db
            .select({ standing: sql<number>`count(*)` })
            .from(threadEvent)
            .where(unfolded(window))
            .get(),
        ),
        (row) => Math.max((row?.standing ?? 0) - 1, 0),
      ),
    );

  const advance = (threadId: string, position: number): Effect.Effect<void, StoreFailure> =>
    units.write(writes('ThreadFootprintFolding.advance', [threadLog]), (unit) =>
      Effect.asVoid(
        unit.run(
          store.db
            .update(threadLog)
            .set({ footprintsThrough: position })
            .where(and(eq(threadLog.threadId, threadId), lt(threadLog.footprintsThrough, position))),
        ),
      ),
    );

  const fold = Effect.fnUntraced(function* (threadId: string, standing: readonly Standing[]) {
    let folded = 0;
    let bytes = 0;
    let refused = 0;
    let decided = 0;
    let frozen = false;
    for (let at = 0; at < standing.length; at += ROWS_PER_UNIT) {
      if (frozen) break;
      const batch = standing.slice(at, at + ROWS_PER_UNIT);
      const written = yield* units
        .write(writes('ThreadFootprintFolding.written', [threadEvent]), (unit) =>
          Effect.gen(function* () {
            let moved = 0;
            let removed = 0;
            for (const row of batch) {
              const payload = yield* Effect.try({
                try: () => decodeThreadEventPayload(kinds, threadId, row.payload),
                catch: (cause) => new ThreadStorageFailed({ call: 'ThreadFootprintFolding.fold', cause }),
              });
              if (footprintTools(payload) === null) continue;
              const next = foldedFootprint(payload);
              yield* unit.run(
                store.db
                  .update(threadEvent)
                  .set({ payload: next })
                  .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, row.position))),
              );
              moved += 1;
              removed += Buffer.byteLength(JSON.stringify(payload), 'utf8') - Buffer.byteLength(JSON.stringify(next), 'utf8');
            }
            return { moved, removed };
          }),
        )
        .pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.as(
                Effect.logWarning('a standing measurement footprint could not be folded', {
                  threadId,
                  position: batch[0]?.position,
                  reason: said(failure),
                }),
                null,
              ),
            onSuccess: Effect.succeed,
          }),
        );
      if (written === null) {
        refused += batch.length;
        frozen = true;
        continue;
      }
      folded += written.moved;
      bytes += written.removed;
      decided = batch[batch.length - 1]!.position;
    }
    return { folded, bytes, refused, decided, frozen };
  });

  return {
    pass: Effect.fn('ThreadFootprintFolding.pass')(function* () {
      const threads: ThreadFolded[] = [];
      let seen = 0;
      let folded = 0;
      let bytesRemoved = 0;
      let newest = 0;
      let refused = 0;
      let remaining = 0;
      let budget = PASS_BUDGET;
      const [, freed] = yield* store.freeing(
        Effect.gen(function* () {
          for (const window of yield* pending()) {
            if (budget <= 0) {
              remaining += yield* foldable(window);
              continue;
            }
            let at = window.foldedThrough;
            let measurements = 0;
            let bytes = 0;
            let more = true;
            while (more && budget > 0) {
              const room = Math.min(budget, ROWS_PER_READ);
              const found = yield* standing({ threadId: window.threadId, foldedThrough: at }, room + 1);
              if (found.length === 0) {
                more = false;
                break;
              }
              const bounded = found.length > room;
              const taken = bounded ? found.slice(0, room) : found.slice(0, -1);
              if (!bounded) {
                newest += 1;
                more = false;
              }
              seen += bounded ? taken.length : found.length;
              budget -= taken.length;
              const outcome = taken.length === 0 ? NOTHING_FOLDED : yield* fold(window.threadId, taken);
              refused += outcome.refused;
              folded += outcome.folded;
              measurements += outcome.folded;
              bytes += outcome.bytes;
              bytesRemoved += outcome.bytes;
              const decided = outcome.frozen
                ? outcome.decided
                : bounded
                  ? (taken[taken.length - 1]?.position ?? 0)
                  : found[found.length - 1]!.position - 1;
              if (decided > at) {
                yield* advance(window.threadId, decided);
                at = decided;
              }
              if (outcome.frozen) more = false;
            }
            if (measurements > 0) threads.push({ threadId: window.threadId, measurements, bytes });
            if (more) remaining += yield* foldable({ threadId: window.threadId, foldedThrough: at });
          }
        }),
      );
      if (seen > 0) {
        yield* Effect.logInfo('standing measurement footprints folded', {
          threads: threads.length,
          seen,
          folded,
          bytesRemoved,
          newest,
          refused,
          remaining,
          pagesFreed: freed,
        });
      }
      return {
        threads,
        seen,
        folded,
        bytesRemoved,
        newest,
        refused,
        remaining,
        pagesFreed: freed,
      };
    }),
  };
});

const said = (failure: StoreFailure | ThreadStorageFailed): string =>
  (failure instanceof Error ? failure.message : String(failure)).split('\n', 1)[0]!.slice(0, 300);
