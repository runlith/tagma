import { Effect, Result } from 'effect';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { ThreadStorageFailed, decodeThreadEventPayloadResult } from '@runlith/agent/thread/persisted';
import type { ThreadTranscript, ThreadTranscriptEntry, ThreadTranscriptPage } from '@runlith/agent/transcript/rows';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { threadEventFact, transcriptFact } from '@runlith/agent/thread/ThreadEventDoor';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadTranscriptQuery } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadEntryPlacement, ThreadEventFact } from '@runlith/agent/transcript/eventFold';
import { and, asc, desc, eq, gt, inArray, lt, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import { pagesOf, rowsPerStatement } from '../../platform/store/binds.js';
import type { StoredFailure } from '../../platform/store/crossing.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type ProgramUnit, type Unit } from '../../platform/contract/service/units.js';
import { unplannable } from '../../platform/store/programs.js';
import { bindQuery } from '../../platform/store/queries.js';
import { runIdOf, threadLog, typeOf } from '../store/thread.js';
import { ENTRY_OPEN_QUESTION_INDEX, threadEntry } from '../../threads/store/kernel.js';
import { threadBase, threadEvent, threadEventIdentity } from '../../threads/store/journal.js';
import type { PlannedFact } from '../../threads/journal/log.js';
import { entryField, payloadField } from '../../threads/store/fields.js';
import { movesSaid, SAID_ENTRY_TYPES, saidOfRuns } from '../../threads/list/said.js';
import { bodyInFold, foldedEntryId, foldedToolFact, restoredFact, toolEventIdentity } from '../../threads/journal/foldedFacts.js';
import { markThreadEntry } from '@runlith/agent/transcript/eventFold';
import { makeLayeredEntries } from './layers.js';

//! Room for the layer arms a branch's read adds to every chunked statement.
const BINDS = rowsPerStatement(1) - 1024;

export type TranscriptRows = Effect.Success<typeof makeTranscriptRows>;

export const makeTranscriptRows = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const parsed = new WeakMap<Unit<'machine'>, Map<string, ThreadTranscript>>();

  const heldIn = (unit: Unit<'machine'>): Map<string, ThreadTranscript> => {
    const held = parsed.get(unit);
    if (held) return held;
    const folds = new Map<string, ThreadTranscript>();
    parsed.set(unit, folds);
    return folds;
  };

  const forget = (unit: Unit<'machine'>, id: string): void => {
    parsed.get(unit)?.delete(id);
  };

  const layered = makeLayeredEntries(db);
  const edge = layered.edge;

  const threadId = sql.placeholder('threadId');
  const based = sql`exists (select 1 from ${threadBase} where ${threadBase.threadId} = ${threadId} or ${threadBase.sourceId} = ${threadId})`;
  const lowest = sql<number>`coalesce((select min(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${threadId}), 0)`;
  const highest = sql<number>`coalesce((select max(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${threadId}), -1)`;
  const planned = {
    bounds: db.all<{ low: number; high: number; layered: number }>(sql`select ${lowest} as low, ${highest} as high, ${based} as layered`),
    guard: db
      .select({ id: threadLog.threadId })
      .from(threadLog)
      .where(
        and(
          eq(threadLog.threadId, threadId),
          eq(threadLog.entriesThrough, sql.placeholder('through')),
          sql`not ${based}`,
          sql`${lowest} = ${sql.placeholder('low')}`,
          sql`${highest} = ${sql.placeholder('high')}`,
        ),
      )
      .prepare(),
    insert: db
      .insert(threadEntry)
      .values({
        threadId,
        ord: sql.placeholder('ord'),
        entryId: sql.placeholder('entryId'),
        runId: sql.placeholder('runId'),
        type: sql.placeholder('type'),
        entry: sql.placeholder('entry'),
      })
      .prepare(),
    replace: db
      .update(threadEntry)
      .set({ entry: sql.placeholder('entry'), runId: sql.placeholder('runId'), type: sql.placeholder('type') })
      .where(and(eq(threadEntry.threadId, threadId), eq(threadEntry.entryId, sql.placeholder('entryId'))))
      .prepare(),
    folded: db
      .update(threadEvent)
      .set({ payload: sql.placeholder('payload') })
      .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, sql.placeholder('position'))))
      .prepare(),
    identity: db
      .select({ position: threadEvent.position, payload: threadEvent.payload })
      .from(threadEvent)
      .where(
        and(
          eq(threadEvent.threadId, threadId),
          lte(threadEvent.position, sql.placeholder('through')),
          sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`,
          sql`${threadEventIdentity(threadEvent.payload)} = ${sql.placeholder('identity')}`,
          bodyInFold(threadEvent.payload),
        ),
      )
      .orderBy(desc(threadEvent.position))
      .prepare(),
    restored: db
      .update(threadEvent)
      .set({ payload: sql.placeholder('payload') })
      .where(
        and(
          eq(threadEvent.threadId, threadId),
          eq(threadEvent.position, sql.placeholder('position')),
          eq(threadEvent.payload, sql.param(sql.placeholder('held'), threadEvent.payload)),
        ),
      )
      .prepare(),
    cursor: db
      .update(threadLog)
      .set({ entriesThrough: sql.placeholder('through') })
      .where(eq(threadLog.threadId, threadId))
      .prepare(),
    suffix: db
      .select({ id: threadEvent.id, kind: threadEvent.kind, payload: threadEvent.payload })
      .from(threadEvent)
      .where(
        and(
          eq(threadEvent.threadId, threadId),
          gt(
            threadEvent.position,
            sql<number>`coalesce((select ${threadLog.entriesThrough} from ${threadLog} where ${threadLog.threadId} = ${threadId}), 0)`,
          ),
        ),
      )
      .orderBy(asc(threadEvent.position))
      .prepare(),
  };

  const entriesWhere = Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, where: SQL | undefined) {
    const rows = yield* layered.rows(unit, id, where);
    return yield* Effect.forEach(rows, (row) => storedEntry(kinds, id, row.entry));
  });

  const chunkedRows = Effect.fnUntraced(function* (
    unit: Unit<'machine'>,
    id: string,
    column: typeof threadEntry.runId | typeof threadEntry.entryId,
    values: readonly string[],
  ) {
    const found: ThreadTranscriptEntry[] = [];
    for (const chunk of chunked(values)) found.push(...(yield* entriesWhere(unit, id, inArray(column, chunk))));
    return found;
  });

  const rowsOfRuns = (unit: Unit<'machine'>, id: string, runIds: readonly string[]): Effect.Effect<ThreadTranscript, StoredFailure> =>
    chunkedRows(unit, id, threadEntry.runId, runIds);

  return {
    edge,
    layered,
    forget,
    rowsOfRuns,
    strip: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, folded: ReadonlyMap<string, FoldedFact>) {
      for (const fact of folded.values()) {
        if (foldedEntryId(fact.payload) !== null) continue;
        yield* unit.run(
          db
            .update(threadEvent)
            .set({ payload: foldedToolFact(fact.payload, fact.entry) })
            .where(and(eq(threadEvent.threadId, id), eq(threadEvent.position, fact.position))),
        );
      }
    }),
    restore: Effect.fnUntraced(function* (
      unit: Unit<'machine'>,
      id: string,
      through: number,
      seed: ThreadTranscript,
      placements: readonly ThreadEntryPlacement[],
    ) {
      const moved = new Set<string>();
      for (const placement of placements) {
        if (placement.kind === 'withdraw' || placement.kind === 'mark') for (const gone of placement.ids) moved.add(gone);
        else if (placement.kind === 'replace') moved.add(placement.entry.id);
      }
      if (moved.size === 0) return;
      for (const entry of seed) {
        if (!moved.has(entry.id)) continue;
        const identity = toolEventIdentity(entry);
        if (identity === null) continue;
        const held = yield* unit.run(planned.identity.get({ threadId: id, through, identity }));
        if (held === undefined) continue;
        const heldEntryId = foldedEntryId(held.payload);
        if (heldEntryId !== entry.id) {
          return yield* new ThreadStorageFailed({
            call: 'entryFold.restore',
            cause: new Error(`Folded event ${held.position} names entry ${heldEntryId ?? 'none'} while row ${entry.id} is moving.`),
          });
        }
        yield* unit.run(
          db
            .update(threadEvent)
            .set({ payload: restoredFact(held.payload, entry) })
            .where(and(eq(threadEvent.threadId, id), eq(threadEvent.position, held.position))),
        );
      }
    }),
    place: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, placements: readonly ThreadEntryPlacement[]) {
      if (placements.length === 0) return 0;
      forget(unit, id);
      const { low, high } = yield* edge(unit, id);
      let next = high + 1;
      let first = low - 1;
      let written = 0;
      const said = new Set<string>();
      const speaking = (entry: ThreadTranscriptEntry, appended: boolean): void => {
        const runId = runIdOf(entry);
        if (runId !== null && movesSaid(entry, appended)) said.add(runId);
      };
      const owned = (ids: readonly string[]) =>
        unit.run(
          db
            .select({ ord: threadEntry.ord, entryId: threadEntry.entryId })
            .from(threadEntry)
            .where(and(eq(threadEntry.threadId, id), inArray(threadEntry.entryId, [...ids]))),
        );
      const copied = Effect.fnUntraced(function* (ids: readonly string[], change: (entry: ThreadTranscriptEntry) => ThreadTranscriptEntry) {
        const own = yield* owned(ids);
        const held = new Set(own.map((row) => row.entryId));
        const above = yield* layered.inherited(
          unit,
          id,
          ids.filter((entryId) => !held.has(entryId)),
        );
        yield* layered.preserve(unit, id, [...own.map((row) => row.ord), ...above.map((row) => row.ord)]);
        yield* layered.keep(
          unit,
          id,
          yield* Effect.forEach(above, (row) =>
            Effect.map(storedEntry(kinds, id, row.entry), (entry) => {
              const next = change(entry);
              return { ...row, runId: runIdOf(next), type: typeOf(next), entry: next };
            }),
          ),
        );
        return own;
      });
      for (const placement of placements) {
        if (placement.kind === 'mark') {
          const marked =
            placement.rewound === null
              ? sql`json_remove(${threadEntry.entry}, '$.rewound')`
              : sql`json_set(${threadEntry.entry}, '$.rewound', json(${JSON.stringify(placement.rewound)}))`;
          for (const ids of chunked(placement.ids)) {
            yield* copied(ids, (entry) => markThreadEntry(entry, placement.rewound));
            yield* unit.run(
              db
                .update(threadEntry)
                .set({ entry: marked as unknown as ThreadTranscriptEntry })
                .where(and(eq(threadEntry.threadId, id), inArray(threadEntry.entryId, ids))),
            );
          }
          written += placement.ids.length;
          continue;
        }
        if (placement.kind === 'withdraw') {
          for (const ids of chunked(placement.ids)) {
            const own = yield* owned(ids);
            const held = new Set(own.map((row) => row.entryId));
            const above = yield* layered.inherited(
              unit,
              id,
              ids.filter((entryId) => !held.has(entryId)),
            );
            const taken = yield* unit.run(
              db
                .selectDistinct({ runId: threadEntry.runId })
                .from(threadEntry)
                .where(and(eq(threadEntry.threadId, id), inArray(threadEntry.entryId, ids))),
            );
            yield* layered.hide(unit, id, [...new Set([...taken, ...above].flatMap((row) => (row.runId === null ? [] : [row.runId])))]);
            yield* layered.preserve(
              unit,
              id,
              own.map((row) => row.ord),
            );
            const gone = and(eq(threadEntry.threadId, id), inArray(threadEntry.entryId, ids));
            const runs = yield* unit.run(
              db
                .selectDistinct({ runId: threadEntry.runId })
                .from(threadEntry)
                .where(and(gone, inArray(threadEntry.type, [...SAID_ENTRY_TYPES]))),
            );
            for (const run of runs) if (run.runId !== null) said.add(run.runId);
            yield* unit.run(db.delete(threadEntry).where(gone));
          }
          written += placement.ids.length;
          continue;
        }
        if (placement.kind === 'replace') {
          speaking(placement.entry, false);
          yield* copied([placement.entry.id], () => placement.entry);
          yield* unit.run(
            db
              .update(threadEntry)
              .set({ entry: placement.entry, runId: runIdOf(placement.entry), type: typeOf(placement.entry) })
              .where(and(eq(threadEntry.threadId, id), eq(threadEntry.entryId, placement.entry.id))),
          );
          written += 1;
          continue;
        }
        const ord = placement.kind === 'append' ? next++ : first--;
        speaking(placement.entry, placement.kind === 'append');
        yield* unit.run(
          db.insert(threadEntry).values({
            threadId: id,
            ord,
            entryId: placement.entry.id,
            runId: runIdOf(placement.entry),
            type: typeOf(placement.entry),
            entry: placement.entry,
          }),
        );
        written += 1;
      }
      if (said.size > 0) yield* unit.run(saidOfRuns(db, id, [...said]));
      return written;
    }),
    plan: Effect.fnUntraced(function* (
      program: ProgramUnit<'machine'>,
      id: string,
      placements: readonly ThreadEntryPlacement[],
      facts: readonly PlannedFact[],
      through: number,
    ) {
      if (placements.some((placement) => placement.kind === 'mark' || placement.kind === 'withdraw'))
        return yield* unplannable(program, 'a withdrawal or a rewind mark');
      const replaced = placements.flatMap((placement) => (placement.kind === 'replace' ? [placement.entry.id] : []));
      const read = yield* units.read((unit) =>
        Effect.gen(function* () {
          const [span] = yield* unit.run(planned.bounds.execute({ threadId: id }));
          const old = replaced.length === 0 ? [] : yield* chunkedRows(unit, id, threadEntry.entryId, replaced);
          const held: { readonly entry: ThreadTranscriptEntry; readonly position: number; readonly payload: ThreadEventPayloadValue }[] =
            [];
          for (const entry of old) {
            const identity = toolEventIdentity(entry);
            if (identity === null) continue;
            const event = yield* unit.run(planned.identity.get({ threadId: id, through, identity }));
            if (event !== undefined) held.push({ entry, ...event });
          }
          return { span, held };
        }),
      );
      if (read.span === undefined || read.span.layered === 1) return yield* unplannable(program, 'a layered transcript');
      const { low, high } = read.span;
      yield* program.guard(bindQuery(planned.guard, { threadId: id, through, low, high }), 1);
      for (const { entry, position, payload } of read.held) {
        if (foldedEntryId(payload) !== entry.id) return yield* unplannable(program, `folded event ${position} names another entry`);
        yield* program.write(
          bindQuery(planned.restored, { threadId: id, position, payload: restoredFact(payload, entry), held: payload }),
          1,
        );
      }
      let next = high + 1;
      let first = low - 1;
      const said = new Set<string>();
      for (const placement of placements) {
        if (placement.kind === 'mark' || placement.kind === 'withdraw') continue;
        const appended = placement.kind === 'append';
        const runId = runIdOf(placement.entry);
        if (runId !== null && movesSaid(placement.entry, appended)) said.add(runId);
        if (placement.kind === 'replace') {
          yield* program.write(
            bindQuery(planned.replace, {
              threadId: id,
              entryId: placement.entry.id,
              entry: placement.entry,
              runId,
              type: typeOf(placement.entry),
            }),
            1,
          );
        } else {
          const ord = appended ? next++ : first--;
          yield* program.write(
            bindQuery(planned.insert, {
              threadId: id,
              ord,
              entryId: placement.entry.id,
              runId,
              type: typeOf(placement.entry),
              entry: placement.entry,
            }),
            1,
          );
        }
        const fact = facts.findLast(
          (each) => (each.payload as { readonly entry?: { readonly id?: unknown } }).entry?.id === placement.entry.id,
        );
        if (fact !== undefined && placement.entry.type === 'tool' && foldedEntryId(fact.payload) === null)
          yield* program.write(
            bindQuery(planned.folded, {
              threadId: id,
              position: fact.position,
              payload: foldedToolFact(fact.payload, placement.entry as ThreadToolEntry),
            }),
            1,
          );
      }
      if (said.size > 0) yield* program.write(saidOfRuns(db, id, [...said]));
      const last = facts.at(-1);
      if (last !== undefined) yield* program.write(bindQuery(planned.cursor, { threadId: id, through: last.position }), 1);
    }),
    seed: (unit: Unit<'machine'>, id: string, transcript: ThreadTranscript): Effect.Effect<void, StoredFailure> =>
      transcript.length === 0
        ? Effect.void
        : Effect.asVoid(
            unit.run(
              db.insert(threadEntry).values(
                transcript.map((entry, ord) => ({
                  threadId: id,
                  ord,
                  entryId: entry.id,
                  runId: runIdOf(entry),
                  type: typeOf(entry),
                  entry,
                })),
              ),
            ),
          ),
    suffix: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
      const rows = yield* unit.run(planned.suffix.all({ threadId: id }));
      const facts = rows.map((row) => transcriptFact(kinds, id, row.kind, row.id, row.payload));
      return facts.filter(
        (fact) => fact.entry !== undefined || fact.withdrawn !== undefined || fact.rewound !== undefined || fact.restored !== undefined,
      );
    }),
    seedFor: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, facts: readonly ThreadEventFact[]) {
      const runs = new Set<string>();
      const ids = new Set<string>();
      for (const fact of facts) {
        if (fact.withdrawn) runs.add(fact.withdrawn.runId);
        for (const runId of fact.rewound?.runIds ?? fact.restored?.runIds ?? []) runs.add(runId);
        if (fact.entry !== undefined) ids.add(fact.entry.id);
      }
      const seed: ThreadTranscriptEntry[] = [];
      const seen = new Set<string>();
      const keep = (entries: ThreadTranscript): void => {
        for (const entry of entries) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          seed.push(entry);
        }
      };
      keep(yield* rowsOfRuns(unit, id, [...runs]));
      keep(yield* chunkedRows(unit, id, threadEntry.entryId, [...ids]));
      return seed;
    }),
    rows: Effect.fnUntraced(
      function* (unit: Unit<'machine'>, id: string) {
        const held = heldIn(unit).get(id);
        if (held !== undefined) return held;
        const rows = yield* layered.rows(unit, id);
        yield* Effect.annotateCurrentSpan({ rows: rows.length });
        const transcript: ThreadTranscript = yield* Effect.forEach(rows, (row) => storedEntry(kinds, id, row.entry));
        heldIn(unit).set(id, transcript);
        return transcript;
      },
      Effect.withSpan('ThreadStorage.checkpoint.load', (_unit, id) => ({ attributes: { threadId: id, fold: 'entries' } })),
    ),
    questionRowsById: (unit: Unit<'machine'>, id: string, questionId: string) =>
      entriesWhere(unit, id, and(eq(threadEntry.type, 'question'), sql`${entryField(threadEntry.entry, 'questionId')} = ${questionId}`)),
    openQuestionSeed: Effect.fn('ThreadStorage.openQuestions.seed')(function* (
      unit: Unit<'machine'>,
      id: string,
      runId: string,
      changed: readonly string[],
    ) {
      const found = new Map<number, ThreadTranscriptEntry>();
      const standing = yield* layered.arms(unit, id);
      const arms = [...standing.slice(1), standing[0]!];
      const columns = {
        ord: sql<number>`${threadEntry.ord}`.as('ord'),
        entry: sql<ThreadTranscriptEntry>`${threadEntry.entry}`.mapWith(threadEntry.entry).as('entry'),
      };
      for (const arm of arms) {
        const rows = yield* unit.run(
          db
            .select(columns)
            .from(sql`${threadEntry} indexed by ${sql.identifier(ENTRY_OPEN_QUESTION_INDEX)}`)
            .where(
              and(
                arm.where,
                eq(threadEntry.runId, runId),
                sql`${threadEntry.type} = 'question' and ${entryField(threadEntry.entry, 'status')} = 'open'`,
              ),
            ),
        );
        for (const row of rows) found.set(row.ord, row.entry);
      }
      for (const ids of pagesOf([...new Set(changed)], 1, (entryId) => entryId.length)) {
        for (const arm of arms) {
          const rows = yield* unit.run(
            db
              .select(columns)
              .from(threadEntry)
              .where(and(arm.where, eq(threadEntry.runId, runId), eq(threadEntry.type, 'question'), inArray(threadEntry.entryId, ids))),
          );
          for (const row of rows) found.set(row.ord, row.entry);
        }
      }
      return yield* Effect.forEach(
        [...found].sort(([left], [right]) => left - right),
        ([, entry]) => storedEntry(kinds, id, entry),
      );
    }),
    rowById: (unit: Unit<'machine'>, id: string, entryId: string): Effect.Effect<ThreadTranscriptEntry | undefined, StoredFailure> =>
      Effect.map(entriesWhere(unit, id, eq(threadEntry.entryId, entryId)), (rows) => rows[0]),
    moveCursor: (unit: Unit<'machine'>, id: string, through: number): Effect.Effect<void, StoredFailure> =>
      Effect.asVoid(unit.run(db.update(threadLog).set({ entriesThrough: through }).where(eq(threadLog.threadId, id)))).pipe(
        Effect.withSpan('ThreadStorage.checkpoint.write', { attributes: { threadId: id, rows: 1, fold: 'entries' } }),
      ),
  };
});

export type Placed = { ord: number; entry: ThreadTranscriptEntry };

export type FoldedFact = {
  readonly position: number;
  readonly payload: ThreadEventPayloadValue;
  readonly entry: ThreadToolEntry;
};

export type Weighed = { ord: number; weight: number; entry?: ThreadTranscriptEntry };

export const weighed = (slot: Placed): Weighed => ({
  ord: slot.ord,
  weight: wireWeight(slot.entry.type, JSON.stringify(slot.entry).length),
  entry: slot.entry,
});

export const wireWeight = (type: string | null, size: number): number => (type === 'tool' ? Math.min(size, WIRE_ENTRY_MAX_BYTES) : size);

export const takeTranscriptPage = Effect.fnUntraced(function* (
  candidates: readonly Weighed[],
  query: ThreadTranscriptQuery,
  bodies: (taken: readonly Weighed[]) => Effect.Effect<readonly Placed[], StoredFailure>,
  older: (floor: number) => Effect.Effect<boolean, StoredFailure>,
) {
  const taken: Weighed[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (taken.length > 0 && bytes + candidate.weight > query.bytes) break;
    bytes += candidate.weight;
    taken.push(candidate);
  }
  taken.reverse();
  const oldest = taken[0]?.ord;
  if (oldest === undefined) return { entries: [], before: null };
  const page = yield* bodies(taken);
  const floor = page[0]?.ord ?? oldest;
  return {
    entries: page.map((slot) => slot.entry),
    before: (yield* older(floor)) ? floor : null,
  };
});

export function bounds(roof: number | undefined, withdrawn: readonly string[]): SQL[] {
  const conditions: SQL[] = [];
  if (roof !== undefined) conditions.push(lt(threadEntry.ord, roof));
  for (const ids of chunked(withdrawn)) conditions.push(notInArray(threadEntry.entryId, ids));
  return conditions;
}

export function* chunked<T>(values: readonly T[]): Generator<T[]> {
  for (let at = 0; at < values.length; at += BINDS) yield values.slice(at, at + BINDS);
}

export function factOf(
  kinds: ThreadEntryReader,
  thread: string,
  kind: string,
  payload: unknown,
): Effect.Effect<ThreadEventFact, ThreadStorageFailed> {
  const read = decodeThreadEventPayloadResult(kinds, thread, payload);
  return Result.isFailure(read)
    ? Effect.fail(new ThreadStorageFailed({ call: 'transcript.event', cause: read.failure }))
    : Effect.succeed(threadEventFact({ kind, payload: read.success }));
}

export function storedEntry(
  kinds: ThreadEntryReader,
  thread: string,
  value: unknown,
): Effect.Effect<ThreadTranscriptEntry, ThreadStorageFailed> {
  const read = kinds.stored(thread, value);
  return Result.isFailure(read)
    ? Effect.fail(new ThreadStorageFailed({ call: 'transcript.entry', cause: read.failure }))
    : Effect.succeed(read.success);
}
