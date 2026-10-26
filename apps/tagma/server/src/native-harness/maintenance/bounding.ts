import { stat } from 'node:fs/promises';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Data, Effect, Result } from 'effect';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { entryOf, ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadLog } from '../store/thread.js';
import { THREAD_ENTRY_TOOL_LENGTH_INDEX, threadEntry } from '../../threads/store/kernel.js';
import { threadEvent, threadEventIdentity } from '../../threads/store/journal.js';
import { payloadField } from '../../threads/store/fields.js';
import { toolEventIdentity } from '../../threads/journal/foldedFacts.js';
import { ToolOutputs } from '../contract/service/toolOutputs.js';
import { retainedToolValue, type RetainedToolValue } from '../contract/wire/toolResult.js';

export type ThreadBounded = { readonly threadId: string; readonly rows: number; readonly bytes: number };

export type BoundingReport = {
  readonly threads: readonly ThreadBounded[];
  readonly rows: number;
  readonly events: number;
  readonly bytesRemoved: number;
  readonly bytesWritten: number;
  readonly eventBytes: number;
  readonly left: number;
  readonly refused: number;
  readonly pagesFreed: number;
};

export class BoundingMoveFailed extends Data.TaggedError('BoundingMoveFailed')<{
  readonly threadId: string;
  readonly message: string;
}> {}

type Candidate = { readonly threadId: string; readonly ord: number; readonly entryId: string };

type Outcome = { readonly kind: 'moved'; readonly rewritten: Rewritten } | { readonly kind: 'left' } | { readonly kind: 'refused' };

const LEFT = { kind: 'left' } as const;
const REFUSED = { kind: 'refused' } as const;

type Moved = { readonly pointer: RetainedToolValue; readonly bytes: number };

type Rewritten = {
  readonly removed: number;
  readonly written: number;
  readonly events: number;
  readonly eventBytes: number;
};

export const makeEntryBounding = Effect.gen(function* () {
  const store = yield* MachineStore;
  const outputs = (yield* ToolOutputs).store;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const candidates = (): Effect.Effect<readonly Candidate[], StoreFailure> =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          store.db
            .select({
              threadId: sql<string>`${threadEntry.threadId}`,
              ord: sql<number>`${threadEntry.ord}`,
              entryId: sql<string>`${threadEntry.entryId}`,
            })
            .from(sql`${threadEntry} indexed by ${sql.identifier(THREAD_ENTRY_TOOL_LENGTH_INDEX)}`)
            .leftJoin(threadLog, eq(threadLog.threadId, threadEntry.threadId))
            .where(
              and(
                sql`${threadEntry.type} = 'tool'`,
                sql`length(${threadEntry.entry}) > ${WIRE_ENTRY_MAX_BYTES}`,
                sql`(${threadLog.boundedThrough} is null or ${threadEntry.ord} > ${threadLog.boundedThrough})`,
              ),
            )
            .orderBy(asc(threadEntry.threadId), asc(threadEntry.ord)),
        ),
        (rows) =>
          rows.map((row) => ({
            threadId: row.threadId,
            ord: row.ord,
            entryId: row.entryId,
          })),
      ),
    );

  const advance = (threadId: string, ord: number): Effect.Effect<void, StoreFailure> =>
    units.write(writes('ThreadEntryBounding.advance', [threadLog]), (unit) =>
      Effect.asVoid(
        unit.run(
          store.db
            .update(threadLog)
            .set({ boundedThrough: ord })
            .where(
              and(eq(threadLog.threadId, threadId), sql`(${threadLog.boundedThrough} is null or ${threadLog.boundedThrough} < ${ord})`),
            ),
        ),
      ),
    );

  const entryRow = (unit: Unit<'machine'>, threadId: string, entryId: string) =>
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
          const current = kinds.decode(row.entry);
          return Result.isFailure(current)
            ? Effect.fail(new BoundingMoveFailed({ threadId, message: current.failure.message }))
            : Effect.succeed({ entry: current.success });
        }),
      );

  const eventsCarrying = (unit: Unit<'machine'>, threadId: string, identity: string) =>
    unit
      .run(
        store.db
          .select({ position: threadEvent.position, payload: threadEvent.payload })
          .from(threadEvent)
          .where(
            and(
              eq(threadEvent.threadId, threadId),
              sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`,
              sql`${threadEventIdentity(threadEvent.payload)} = ${identity}`,
            ),
          ),
      )
      .pipe(
        Effect.flatMap((rows) =>
          Effect.try({
            try: () => rows.map((row) => ({ ...row, payload: decodeThreadEventPayload(kinds, row.payload) })),
            catch: (cause) => new BoundingMoveFailed({ threadId, message: said(cause) }),
          }),
        ),
      );

  const standing = (threadId: string, entryId: string): Effect.Effect<readonly string[], StoreFailure | BoundingMoveFailed> =>
    units.read((unit) =>
      Effect.gen(function* () {
        const row = yield* entryRow(unit, threadId, entryId);
        if (row === undefined) return [];
        const held = oversizedValue(row.entry);
        if (held === null) return [];
        const values = [held];
        const identity = toolEventIdentity(row.entry);
        if (identity === null) return values;
        for (const event of yield* eventsCarrying(unit, threadId, identity)) {
          const carried = event.payload.entry;
          if (carried === undefined) continue;
          const value = oversizedValue(carried);
          if (value !== null && !values.includes(value)) values.push(value);
        }
        return values;
      }),
    );

  const boundEvents = Effect.fnUntraced(function* (
    unit: Unit<'machine'>,
    threadId: string,
    entry: ThreadTranscriptEntry,
    files: ReadonlyMap<string, Moved>,
  ) {
    const identity = toolEventIdentity(entry);
    if (identity === null) return { rows: 0, bytes: 0 };
    const carried = yield* eventsCarrying(unit, threadId, identity);
    let rows = 0;
    let bytes = 0;
    for (const event of carried) {
      const held = event.payload.entry;
      if (held === undefined) continue;
      const value = oversizedValue(held);
      if (value === null) continue;
      const moved = files.get(value);
      if (moved === undefined) continue;
      yield* unit.run(
        store.db
          .update(threadEvent)
          .set({ payload: { ...event.payload, entry: { ...held, toolOutput: moved.pointer } } })
          .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, event.position))),
      );
      rows += 1;
      bytes += Buffer.byteLength(value, 'utf8');
    }
    return { rows, bytes };
  });

  const rewrite = (
    threadId: string,
    entryId: string,
    files: ReadonlyMap<string, Moved>,
  ): Effect.Effect<Outcome, StoreFailure | BoundingMoveFailed> =>
    units.write(writes('ThreadEntryBounding.rewrite', [threadEntry, threadEvent]), (unit) =>
      Effect.gen(function* () {
        const row = yield* entryRow(unit, threadId, entryId);
        if (row === undefined || !entryOf('tool')(row.entry)) return LEFT;
        const held = oversizedValue(row.entry);
        if (held === null) return LEFT;
        const moved = files.get(held);
        if (moved === undefined) return LEFT;
        yield* unit.run(
          store.db
            .update(threadEntry)
            .set({ entry: { ...row.entry, toolOutput: moved.pointer } })
            .where(and(eq(threadEntry.threadId, threadId), eq(threadEntry.entryId, entryId))),
        );
        const events = yield* boundEvents(unit, threadId, row.entry, files);
        return {
          kind: 'moved' as const,
          rewritten: {
            removed: Buffer.byteLength(held, 'utf8'),
            written: moved.bytes,
            events: events.rows,
            eventBytes: events.bytes,
          },
        };
      }),
    );

  const move = Effect.fnUntraced(function* (threadId: string, json: string) {
    const written = yield* Effect.tryPromise({
      try: () => outputs.write(threadId, json),
      catch: (cause) => new BoundingMoveFailed({ threadId, message: `the value could not be written: ${said(cause)}` }),
    });
    const measured = yield* Effect.tryPromise({
      try: () => stat(written.path),
      catch: (cause) => new BoundingMoveFailed({ threadId, message: `${written.outputId} could not be measured: ${said(cause)}` }),
    });
    const bytes = Buffer.byteLength(json, 'utf8');
    if (measured.size !== bytes) {
      return yield* new BoundingMoveFailed({
        threadId,
        message: `${written.outputId} holds ${measured.size} bytes of ${bytes}`,
      });
    }
    const pointer = yield* Effect.tryPromise({
      try: () => outputs.retain(threadId, json),
      catch: (cause) => new BoundingMoveFailed({ threadId, message: `the pointer could not be composed: ${said(cause)}` }),
    });
    return { pointer, bytes: measured.size };
  });

  const boundRow = Effect.fnUntraced(
    function* (threadId: string, entryId: string): Effect.fn.Return<Outcome, StoreFailure | BoundingMoveFailed> {
      const values = yield* standing(threadId, entryId);
      if (values.length === 0) return LEFT;
      const files = new Map<string, Moved>();
      for (const value of values) files.set(value, yield* move(threadId, value));
      return yield* rewrite(threadId, entryId, files);
    },
    (effect, threadId, entryId) =>
      Effect.catchTag(effect, 'BoundingMoveFailed', (failure) =>
        Effect.as(Effect.logWarning('a standing entry row could not be bounded', { threadId, entryId, reason: failure.message }), REFUSED),
      ),
  );

  return {
    pass: Effect.fn('ThreadEntryBounding.pass')(function* () {
      const threads: ThreadBounded[] = [];
      let rows = 0;
      let events = 0;
      let bytesRemoved = 0;
      let bytesWritten = 0;
      let eventBytes = 0;
      let left = 0;
      let refused = 0;
      const [, freed] = yield* store.freeing(
        Effect.gen(function* () {
          let current: { threadId: string; rows: number; bytes: number; decided: number | null; frozen: boolean } | null = null;
          const settle = function* () {
            if (current === null) return;
            if (current.rows > 0) threads.push({ threadId: current.threadId, rows: current.rows, bytes: current.bytes });
            if (current.decided !== null) yield* advance(current.threadId, current.decided);
          };
          for (const candidate of yield* candidates()) {
            if (current === null || current.threadId !== candidate.threadId) {
              yield* settle();
              current = { threadId: candidate.threadId, rows: 0, bytes: 0, decided: null, frozen: false };
            }
            const outcome = yield* boundRow(candidate.threadId, candidate.entryId);
            if (outcome.kind === 'refused') {
              refused += 1;
              current.frozen = true;
              continue;
            }
            if (!current.frozen) current.decided = candidate.ord;
            if (outcome.kind === 'left') {
              left += 1;
              continue;
            }
            const bound = outcome.rewritten;
            rows += 1;
            current.rows += 1;
            current.bytes += bound.removed;
            bytesRemoved += bound.removed;
            bytesWritten += bound.written;
            events += bound.events;
            eventBytes += bound.eventBytes;
          }
          yield* settle();
        }),
      );
      if (rows > 0 || left > 0 || refused > 0) {
        yield* Effect.logInfo('standing entry rows bounded', {
          threads: threads.length,
          rows,
          events,
          bytesRemoved,
          left,
          refused,
          pagesFreed: freed,
        });
      }
      return { threads, rows, events, bytesRemoved, bytesWritten, eventBytes, left, refused, pagesFreed: freed };
    }),
  };
});

function oversizedValue(entry: ThreadTranscriptEntry): string | null {
  if (!entryOf('tool')(entry)) return null;
  const output = entry.toolOutput;
  if (output === undefined || retainedToolValue(output) !== null) return null;
  const json = JSON.stringify(output);
  return json.length <= WIRE_ENTRY_MAX_BYTES ? null : json;
}

const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
