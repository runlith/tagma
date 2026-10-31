import { Effect, Result, Schema } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { Message } from '@runlith/llm/schema/messages';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import { HistoryFold, moveThreadHistory } from '@runlith/agent/thread/HistoryFold';
import { measureMessages, type MessageMeasure, recallMessageMeasure } from '@runlith/agent/thread/compaction/ThreadRequestMeter';
import type { ThreadHistory } from '@runlith/agent/thread/rows';
import { and, asc, eq, gt, gte, sql } from 'drizzle-orm';
import { rowsPerStatement } from '../../platform/store/binds.js';
import type { StoredFailure } from '../../platform/store/crossing.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { ProgramQuery, ProgramUnit, Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { unplannable } from '../../platform/store/programs.js';
import { threadHistoryItem, threadLog } from '../store/thread.js';
import { threadEvent } from '../../threads/store/journal.js';
import { messageFieldType } from '../../threads/store/fields.js';
import { formedThread } from '../../threads/journal/formSteps.js';
import type { RestedFolds } from './restedFolds.js';
import { HeldHistories, type HistoryState } from './heldHistories.js';
import { GuidanceIndex } from './guidanceIndex.js';

export type ThreadHistoryStore = Effect.Success<ReturnType<typeof makeHistoryStore>>;

export const makeHistoryStore = Effect.fnUntraced(function* ({ reads }: { readonly reads: RestedFolds | undefined }) {
  const { db } = yield* MachineStore;
  const kinds = yield* ThreadEntryKinds;
  const foldsByUnit = new WeakMap<Unit<'machine'>, Map<string, Held>>();
  const live = new HeldHistories();

  const payloadOf = (value: unknown): ThreadEventPayload | null => {
    const formed = kinds.formEvent(value);
    return Result.isSuccess(formed) && readsAsPayload(formed.success) ? formed.success : null;
  };

  const messageOf = (value: unknown): ThreadHistory[number] | null => {
    const formed = kinds.form('message', value);
    return Result.isSuccess(formed) && readsAsMessage(formed.success) ? formed.success : null;
  };

  const heldIn = (unit: Unit<'machine'>): Map<string, Held> => {
    const held = foldsByUnit.get(unit);
    if (held) return held;
    const folds = new Map<string, Held>();
    foldsByUnit.set(unit, folds);
    return folds;
  };

  const forget = (unit: Unit<'machine'>, id: string): void => {
    foldsByUnit.get(unit)?.delete(id);
  };

  const folded = (stored: ThreadHistory, through: number, suffix: readonly FoldedEvent[], initial: GuidanceIndex): Folded => {
    if (suffix.length === 0) return { history: stored, through, guidance: initial };
    let fold: HistoryFold | undefined;
    let guidance = initial;
    for (const event of suffix) {
      const move = moveThreadHistory({ kind: event.kind, payload: event.payload }, event.position);
      if (move === null) continue;
      fold ??= new HistoryFold(stored);
      fold.move(move);
      guidance = move.kind === 'append' ? guidance.append(move.messages) : new GuidanceIndex().append(fold.take());
    }
    return { history: fold?.take() ?? stored, through: suffix[suffix.length - 1]?.position ?? through, guidance };
  };

  const replay = Effect.fnUntraced(
    function* (unit: Unit<'machine'>, id: string, stored: ThreadHistory, through: number, guidance: GuidanceIndex) {
      const suffix = yield* unit.run(
        db
          .select({ position: threadEvent.position, kind: threadEvent.kind, payload: threadEvent.payload })
          .from(threadEvent)
          .where(and(eq(threadEvent.threadId, id), gt(threadEvent.position, through)))
          .orderBy(asc(threadEvent.position)),
      );
      yield* Effect.annotateCurrentSpan({ events: suffix.length });
      const events: FoldedEvent[] = [];
      for (const event of suffix) {
        const payload = payloadOf(event.payload);
        if (payload === null) return yield* unreadable(id, `event ${event.position}`);
        events.push({ position: event.position, kind: event.kind, payload });
      }
      return yield* Effect.try({
        try: () => folded(stored, through, events, guidance),
        catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
      });
    },
    Effect.withSpan('ThreadStorage.suffix.replay', (_unit, id) => ({ attributes: { threadId: id, fold: 'history' } })),
  );

  const caughtUp = Effect.fnUntraced(
    function* (unit: Unit<'machine'>, id: string, history: ThreadHistory, standing: HistoryState) {
      const rows = yield* unit.run(
        db.all<{ fact: 0 | 1; at: number | null; kind: string | null; body: string | null }>(sql`
          select 0 as fact, ${threadLog.historyThrough} as at, null as kind, null as body
            from ${threadLog}
           where ${threadLog.threadId} = ${id}
          union all
          select 1, ${threadEvent.position}, ${threadEvent.kind}, ${threadEvent.payload}
            from ${threadEvent}
           where ${threadEvent.threadId} = ${id} and ${threadEvent.position} > ${standing.through}
          order by 1, 2`),
      );
      const log = rows[0];
      if (log === undefined || log.fact !== 0 || log.at !== standing.cursor) return null;
      const suffix: FoldedEvent[] = [];
      for (const row of rows) {
        if (row.fact !== 1 || row.at === null || row.kind === null || row.body === null) continue;
        const payload = payloadOf(parsed(row.body));
        if (payload === null) return yield* unreadable(id, `event ${row.at}`);
        suffix.push({ position: row.at, kind: row.kind, payload });
      }
      yield* Effect.annotateCurrentSpan({ events: suffix.length });
      const caught = yield* Effect.try({
        try: () => folded(history, standing.through, suffix, standing.guidance),
        catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
      });
      return { stored: standing.stored, cursor: standing.cursor, ...caught };
    },
    Effect.withSpan('ThreadStorage.suffix.replay', (_unit, id) => ({ attributes: { threadId: id, fold: 'history' } })),
  );

  const holding = Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string) {
    const held = heldIn(unit).get(id);
    if (held !== undefined) {
      const caught = yield* replay(unit, id, held.history, held.through, held.guidance);
      const fresh: Held = { stored: held.stored, cursor: held.cursor, ...caught };
      heldIn(unit).set(id, fresh);
      yield* Effect.annotateCurrentSpan({ rows: 0 });
      return fresh;
    }
    const warm = live.held(id);
    const kept = warm === null ? null : yield* caughtUp(unit, id, warm.history, warm.standing);
    if (kept !== null && warm !== null && live.current(id, warm.entry)) {
      heldIn(unit).set(id, kept);
      if (!writing(unit)) live.offer(id, { entry: warm.entry }, kept.history, kept);
      yield* Effect.annotateCurrentSpan({ rows: 0 });
      return kept;
    }
    const seen = writing(unit) ? null : live.glimpse(id);
    const rows = yield* unit.run(
      db.all<{
        fact: 0 | 1;
        through: number;
        at: number | null;
        kind: string | null;
        body: string | null;
        digest: string | null;
        tokens: number | null;
      }>(sql`
        select 0 as fact, ${threadLog.historyThrough} as through, ${threadHistoryItem.ord} as at, null as kind, ${threadHistoryItem.message} as body,
               ${threadHistoryItem.digest} as digest, ${threadHistoryItem.tokens} as tokens
          from ${threadLog} left join ${threadHistoryItem} on ${threadHistoryItem.threadId} = ${threadLog.threadId}
         where ${threadLog.threadId} = ${id}
        union all
        select 1, ${threadLog.historyThrough}, ${threadEvent.position}, ${threadEvent.kind}, ${threadEvent.payload}, null, null
          from ${threadLog} join ${threadEvent} on ${threadEvent.threadId} = ${threadLog.threadId} and ${threadEvent.position} > ${threadLog.historyThrough}
         where ${threadLog.threadId} = ${id}
        order by 1, 3`),
    );
    const log = rows[0];
    if (log === undefined) return null;
    const stored: ThreadHistory[number][] = [];
    const suffix: FoldedEvent[] = [];
    for (const row of rows) {
      if (row.fact === 0 && row.body !== null) {
        const body = parsed(row.body);
        const message = messageOf(body);
        if (message === null) return yield* unreadable(id, `history item ${row.at}`);
        if (row.digest !== null && message === body) recallMessageMeasure(message, { digest: row.digest, tokens: row.tokens });
        live.weigh(message, row.body.length * 2);
        stored.push(message);
      } else if (row.fact === 1 && row.at !== null && row.kind !== null && row.body !== null) {
        const payload = payloadOf(parsed(row.body));
        if (payload === null) return yield* unreadable(id, `event ${row.at}`);
        suffix.push({ position: row.at, kind: row.kind, payload });
      }
    }
    yield* Effect.annotateCurrentSpan({ rows: stored.length });
    const caught = yield* Effect.try({
      try: () => folded(stored, log.through, suffix, new GuidanceIndex().append(stored)),
      catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
    }).pipe(
      Effect.tap(() => Effect.annotateCurrentSpan({ events: suffix.length })),
      Effect.withSpan('ThreadStorage.suffix.replay', { attributes: { threadId: id, fold: 'history' } }),
    );
    const fresh: Held = { stored, cursor: log.through, ...caught };
    heldIn(unit).set(id, fresh);
    if (seen !== null) live.offer(id, seen, fresh.history, fresh);
    return fresh;
  });

  const read = Effect.fnUntraced(
    function* (unit: Unit<'machine'>, id: string) {
      const held = yield* holding(unit, id);
      if (held !== null) return held.history;
      if (reads === undefined) return null;
      return yield* reads.history(id, unit);
    },
    Effect.withSpan('ThreadStorage.checkpoint.load', (_unit, id) => ({ attributes: { threadId: id, fold: 'history' } })),
  );

  const changedRows = Effect.fnUntraced(function* (id: string, stored: ThreadHistory, next: ThreadHistory) {
    let shared = 0;
    const common = Math.min(stored.length, next.length);
    while (shared < common && Object.is(stored[shared], next[shared])) shared += 1;
    const statements: ProgramQuery[] = [];
    let written = 0;
    if (stored.length === next.length) {
      let last = next.length - 1;
      while (last >= shared && Object.is(stored[last], next[last])) last -= 1;
      const changed = next.slice(shared, last + 1);
      const measures = yield* measured(changed);
      for (let at = 0; at < changed.length; at += 1) {
        statements.push(
          db
            .update(threadHistoryItem)
            .set(measuredRow(changed[at]!, measures[at]!))
            .where(and(eq(threadHistoryItem.threadId, id), eq(threadHistoryItem.ord, shared + at))),
        );
        written += 1;
      }
      return { statements, shared, written };
    }
    if (shared < stored.length) {
      statements.push(db.delete(threadHistoryItem).where(and(eq(threadHistoryItem.threadId, id), gte(threadHistoryItem.ord, shared))));
      written += stored.length - shared;
    }
    const added = next.slice(shared);
    const measures = yield* measured(added);
    for (let at = 0; at < added.length; at += ROWS) {
      const rows = added.slice(at, at + ROWS);
      statements.push(
        db
          .insert(threadHistoryItem)
          .values(
            rows.map((message, offset) => ({ threadId: id, ord: shared + at + offset, ...measuredRow(message, measures[at + offset]!) })),
          ),
      );
    }
    return { statements, shared, written: written + added.length };
  });

  const guided = (id: string, held: Held | null, stored: ThreadHistory, next: ThreadHistory, shared: number) => {
    const previous = held?.history ?? EMPTY;
    let retained = previous === stored ? shared : 0;
    if (previous !== stored)
      while (retained < Math.min(previous.length, next.length) && Object.is(previous[retained], next[retained])) retained += 1;
    return Effect.try({
      try: () =>
        retained === previous.length && held !== null ? held.guidance.append(next.slice(retained)) : new GuidanceIndex().append(next),
      catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
    });
  };

  const restedGuidance = new WeakMap<ThreadHistory, GuidanceIndex>();
  const toldStates = new WeakMap<object, GuidanceState>();

  return {
    read,
    forget,
    toldState: Effect.fn('ThreadStorage.toldState')(function* (unit: Unit<'machine'>, id: string, key: string, toolCallId?: string) {
      const warm = heldIn(unit).has(id) ? null : live.held(id);
      if (warm !== null) {
        const known = toldStates.get(warm.entry) ?? warm.standing;
        const rows = yield* unit.run(
          db.all<{ fact: 0 | 1; at: number; kind: string | null; body: string | null }>(sql`
            select 0 as fact, ${threadLog.historyThrough} as at, null as kind, null as body
              from ${threadLog} where ${threadLog.threadId} = ${id}
            union all
            select 1, ${threadEvent.position}, ${threadEvent.kind}, ${threadEvent.payload}
              from ${threadEvent} where ${threadEvent.threadId} = ${id} and ${threadEvent.position} > ${known.through}
            order by 1, 2`),
        );
        if (rows[0]?.fact === 0 && rows[0].at === known.cursor && live.current(id, warm.entry)) {
          const indexed = yield* Effect.try({
            try: () => {
              let guidance = known.guidance;
              let through = known.through;
              for (const row of rows) {
                if (row.fact !== 1 || row.kind === null || row.body === null) continue;
                const payload = payloadOf(parsed(row.body));
                if (payload === null) return null;
                const move = moveThreadHistory({ kind: row.kind, payload }, row.at);
                if (move !== null) {
                  if (move.kind !== 'append') return null;
                  guidance = guidance.append(move.messages);
                }
                through = row.at;
              }
              return { cursor: known.cursor, through, guidance };
            },
            catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
          });
          if (indexed !== null) {
            toldStates.set(warm.entry, indexed);
            yield* Effect.annotateCurrentSpan({ messages: indexed.guidance.position - known.guidance.position });
            return indexed.guidance.read(key, toolCallId);
          }
        }
      }
      const held = yield* holding(unit, id);
      if (held !== null) return held.guidance.read(key, toolCallId);
      if (reads === undefined) return undefined;
      const history = yield* reads.history(id, unit);
      if (history === null) return undefined;
      const guidance =
        restedGuidance.get(history) ??
        (yield* Effect.try({
          try: () => new GuidanceIndex().append(history),
          catch: (cause) => unreadable(id, `guidance: ${String(cause)}`),
        }));
      restedGuidance.set(history, guidance);
      return guidance.read(key, toolCallId);
    }),
    toldTail: Effect.fnUntraced(
      function* (unit: Unit<'machine'>, id: string, key: string) {
        if (heldIn(unit).has(id) || live.held(id) !== null) return yield* read(unit, id);
        const formed = kinds.steps.some((step) => step.message !== undefined) ? formedThread(sql`${id}`, kinds.last) : undefined;
        const unformed = formed === undefined ? sql`0` : sql`not (${formed})`;
        const rows = yield* unit.run(
          db.all<{ fact: 0 | 1 | 2; at: number | null; kind: string | null; body: string | null }>(sql`
            select 0 as fact, ${threadLog.historyThrough} as at, null as kind, null as body
              from ${threadLog}
             where ${threadLog.threadId} = ${id}
            union all
            select 1, ${threadEvent.position}, ${threadEvent.kind}, ${threadEvent.payload}
              from ${threadLog} join ${threadEvent} on ${threadEvent.threadId} = ${threadLog.threadId} and ${threadEvent.position} > ${threadLog.historyThrough}
             where ${threadLog.threadId} = ${id}
            union all
            select 2, ${threadHistoryItem.ord}, null, ${threadHistoryItem.message}
              from ${threadHistoryItem}
             where ${threadHistoryItem.threadId} = ${id} and (${unformed} or ${threadHistoryItem.ord} >= (
               select told.ord from ${threadHistoryItem} as told
                where told.thread_id = ${id}
                  and (${messageFieldType(sql`told.message`, 'compaction')} is not null or json_type(told.message, ${`$.metadata.runtimeState.${JSON.stringify(key)}`}) is not null)
                 order by told.ord desc limit 1))
            order by 1, 2`),
        );
        if (rows[0]?.fact !== 0) return yield* read(unit, id);
        for (const row of rows) {
          if (row.fact !== 1 || row.kind === null || row.body === null) continue;
          const payload = payloadOf(parsed(row.body));
          if (payload === null) return yield* unreadable(id, `event ${row.at}`);
          if (moveThreadHistory({ kind: row.kind, payload }) !== null) return yield* read(unit, id);
        }
        const tail: ThreadHistory[number][] = [];
        for (const row of rows) {
          if (row.fact !== 2 || row.body === null) continue;
          const message = messageOf(parsed(row.body));
          if (message === null) return yield* unreadable(id, `history item ${row.at}`);
          tail.push(message);
        }
        yield* Effect.annotateCurrentSpan({ rows: tail.length });
        return tail;
      },
      Effect.withSpan('ThreadStorage.told.load', (_unit, id) => ({ attributes: { threadId: id, fold: 'history' } })),
    ),
    write: Effect.fnUntraced(
      function* (unit: WriteUnit<'machine'>, id: string, next: ThreadHistory, through: number) {
        const held = yield* holding(unit, id);
        const stored = held?.stored ?? EMPTY;
        forget(unit, id);
        const claim = live.claim(id, unit);
        const rows = yield* changedRows(id, stored, next);
        for (const statement of rows.statements) yield* unit.run(statement);
        yield* unit.run(db.update(threadLog).set({ historyThrough: through }).where(eq(threadLog.threadId, id)));
        const standing: HistoryState = {
          stored: next,
          cursor: through,
          through,
          guidance: yield* guided(id, held, stored, next, rows.shared),
        };
        heldIn(unit).set(id, { ...standing, history: next });
        yield* unit.afterCommit(Effect.sync(() => live.settle(claim, next, standing)));
        yield* Effect.annotateCurrentSpan({ rows: rows.written + 1, messages: next.length });
      },
      Effect.withSpan('ThreadStorage.checkpoint.write', (_unit, id) => ({ attributes: { threadId: id, fold: 'history' } })),
    ),
    plan: Effect.fnUntraced(function* (
      program: ProgramUnit<'machine'>,
      id: string,
      next: ThreadHistory | undefined,
      through: number,
      standing: number,
      facts: readonly { readonly position: number; readonly kind: string; readonly payload: unknown }[],
    ) {
      const warm = live.held(id);
      if (warm === null || !live.current(id, warm.entry) || warm.standing.through !== standing)
        return yield* unplannable(program, 'the history is not held at the planned head');
      const { stored, cursor } = warm.standing;
      let quiet = cursor;
      if (next === undefined) {
        if (warm.history !== stored) return yield* unplannable(program, 'the held history moved past its stored rows');
        quiet = standing;
        for (const fact of facts) {
          const payload = payloadOf(fact.payload);
          if (payload === null) return yield* unplannable(program, `event ${fact.position} is not a shape the history fold reads`);
          if (moveThreadHistory({ kind: fact.kind, payload }) !== null) break;
          quiet = fact.position;
        }
        if (quiet === cursor) return;
      }
      yield* program.guard(
        db
          .select({ id: threadLog.threadId })
          .from(threadLog)
          .where(and(eq(threadLog.threadId, id), eq(threadLog.historyThrough, cursor))),
        1,
      );
      const claim = live.claim(id, program);
      if (next === undefined) {
        yield* program.write(db.update(threadLog).set({ historyThrough: quiet }).where(eq(threadLog.threadId, id)), 1);
        const moved: HistoryState = { ...warm.standing, cursor: quiet, through: Math.max(warm.standing.through, quiet) };
        return yield* program.afterCommit(Effect.sync(() => live.settle(claim, warm.history, moved)));
      }
      const rows = yield* changedRows(id, stored, next);
      for (const statement of rows.statements) yield* program.write(statement);
      yield* program.write(db.update(threadLog).set({ historyThrough: through }).where(eq(threadLog.threadId, id)), 1);
      const held = { ...warm.standing, history: warm.history };
      const fresh: HistoryState = { stored: next, cursor: through, through, guidance: yield* guided(id, held, stored, next, rows.shared) };
      yield* program.afterCommit(Effect.sync(() => live.settle(claim, next, fresh)));
    }),
    seed: Effect.fnUntraced(function* (unit: Unit<'machine'>, id: string, history: ThreadHistory) {
      const measures = yield* measured(history);
      for (let at = 0; at < history.length; at += ROWS) {
        const rows = history.slice(at, at + ROWS);
        yield* unit.run(
          db
            .insert(threadHistoryItem)
            .values(rows.map((message, offset) => ({ threadId: id, ord: at + offset, ...measuredRow(message, measures[at + offset]!) }))),
        );
      }
    }),
    project: Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, id: string) {
      const rows = yield* unit.run(
        db
          .select({
            through: threadLog.historyThrough,
            position: threadEvent.position,
            kind: threadEvent.kind,
            payload: threadEvent.payload,
          })
          .from(threadLog)
          .leftJoin(threadEvent, and(eq(threadEvent.threadId, threadLog.threadId), gt(threadEvent.position, threadLog.historyThrough)))
          .where(eq(threadLog.threadId, id))
          .orderBy(asc(threadEvent.position)),
      );
      const through = rows[0]?.through ?? 0;
      const suffix =
        rows.length > 0
          ? rows.flatMap((row) =>
              row.position === null || row.kind === null ? [] : [{ position: row.position, kind: row.kind, payload: row.payload }],
            )
          : yield* unit.run(
              db
                .select({ position: threadEvent.position, kind: threadEvent.kind, payload: threadEvent.payload })
                .from(threadEvent)
                .where(eq(threadEvent.threadId, id))
                .orderBy(asc(threadEvent.position)),
            );
      let quiet = through;
      for (const event of suffix) {
        const payload = payloadOf(event.payload);
        if (payload === null) return yield* unreadable(id, `event ${event.position}`);
        if (moveThreadHistory({ kind: event.kind, payload }) !== null) break;
        quiet = event.position;
      }
      if (quiet === through) return;
      const local = heldIn(unit).get(id);
      const warm = local === undefined ? live.held(id) : null;
      const held = local ?? (warm === null ? undefined : { ...warm.standing, history: warm.history });
      const current = held !== undefined && held.cursor === through;
      const seen = current && warm !== null ? live.glimpse(id) : null;
      const claim = current && local !== undefined ? live.claim(id, unit) : null;
      yield* unit.run(db.update(threadLog).set({ historyThrough: quiet }).where(eq(threadLog.threadId, id)));
      if (held === undefined || (claim === null && seen === null)) return forget(unit, id);
      const moved: Held = { ...held, cursor: quiet, through: Math.max(held.through, quiet) };
      heldIn(unit).set(id, moved);
      yield* unit.afterCommit(
        Effect.sync(() => {
          if (claim !== null) live.settle(claim, moved.history, moved);
          else if (seen !== null) live.offer(id, seen, moved.history, moved);
        }),
      );
    }),
  };
});

const holdsMessage = Schema.is(Schema.Struct({ role: Message.fields.role, content: Schema.Array(Schema.Unknown) }));

const holdsMove = Schema.is(
  Schema.Struct({
    messages: Schema.optional(Schema.Array(Schema.Unknown)),
    withdrawn: Schema.optional(Schema.Struct({ keepMessages: Schema.Number })),
    compacted: Schema.optional(Schema.Struct({ keepFrom: Schema.Number, messages: Schema.Array(Schema.Unknown) })),
    rewound: Schema.optional(Schema.Struct({ cuts: Schema.Array(Schema.Struct({ from: Schema.Number, to: Schema.Number })) })),
    restored: Schema.optional(
      Schema.Struct({ inserts: Schema.Array(Schema.Struct({ at: Schema.Number, messages: Schema.Array(Schema.Unknown) })) }),
    ),
  }),
);

const readsAsMessage = (value: unknown): value is ThreadHistory[number] => holdsMessage(value);

const readsAsPayload = (value: unknown): value is ThreadEventPayload => holdsMove(value);

const unreadable = (threadId: string, what: string): ThreadStorageFailed =>
  new ThreadStorageFailed({
    call: 'ThreadHistoryStore.load',
    cause: new Error(`thread ${threadId}: ${what} is not a shape the history fold reads`),
  });

const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const measured = (messages: ThreadHistory) =>
  measureMessages(messages).pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'ThreadHistoryStore.write', cause })));

const measuredRow = (message: ThreadHistory[number], measure: MessageMeasure) => ({
  message,
  digest: measure.digest,
  tokens: measure.tokens,
});

const EMPTY: ThreadHistory = [];
const ROWS = rowsPerStatement(5);

const writing = (unit: Unit<'machine'>): unit is WriteUnit<'machine'> => 'afterCommit' in unit;

type GuidanceState = Pick<HistoryState, 'cursor' | 'through' | 'guidance'>;
type Held = HistoryState & { readonly history: ThreadHistory };
type Folded = { readonly history: ThreadHistory; readonly through: number; readonly guidance: GuidanceIndex };
type FoldedEvent = { readonly position: number; readonly kind: string; readonly payload: ThreadEventPayload };
