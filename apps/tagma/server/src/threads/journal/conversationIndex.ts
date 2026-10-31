import { Effect } from 'effect';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { USER_MESSAGE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { ProgramUnit, WriteUnit } from '../../platform/contract/service/units.js';
import { MESSAGE_FTS, threadConversation, threadMessage, threadMessageGap, threadQuietRun } from '../store/conversation.js';
import type { ConversationRole } from '../contract/wire/conversation.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { BUCKET, keyable, projectionOf } from '@runlith/search-text/fts';
import { voidCovered } from '../recap/voiding.js';
import { threadEntry } from '../store/kernel.js';
import { type BaseLayer, referrersOf } from './base.js';

export type IndexedEvent = { readonly position: number; readonly payload: ThreadEventPayloadValue };

type Said = {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly role?: unknown;
  readonly runId?: unknown;
  readonly text?: unknown;
  readonly occurredAt?: unknown;
  readonly signalType?: unknown;
  readonly rewound?: { readonly by?: unknown };
};

type Facts = {
  readonly entry?: Said;
  readonly withdrawn?: { readonly runId?: unknown };
  readonly rewound?: { readonly id?: unknown; readonly runIds?: unknown };
  readonly restored?: { readonly rewindId?: unknown; readonly runIds?: unknown };
  readonly branched?: { readonly hidden?: unknown; readonly from?: unknown };
};

type Standing = {
  readonly key: string;
  readonly appeared: number;
  readonly occurred_at: number;
  readonly text: string;
  readonly rewound: string | null;
};

const fts = sql.raw(MESSAGE_FTS);

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const roleOf = (role: unknown): ConversationRole | null => (role === 'user' ? 'operator' : role === 'assistant' ? 'agent' : null);

export const CONVERSATION_KINDS: readonly string[] = ['message', 'signal', 'withdrawal', 'rewind', 'restore', 'branch'];

export const speaks = (payload: ThreadEventPayloadValue): boolean => {
  const facts = payload as Facts;
  const type = facts.entry?.type;
  return (
    type === 'message' ||
    type === 'signal' ||
    facts.withdrawn !== undefined ||
    facts.rewound !== undefined ||
    facts.restored !== undefined ||
    facts.branched !== undefined
  );
};

type Db = StoreDb<'machine'>;
type Write = WriteUnit<'machine'>;

const markOf = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string) {
  const held = yield* unit.run(
    db.select({ through: threadConversation.through }).from(threadConversation).where(eq(threadConversation.threadId, threadId)).get(),
  );
  if (held !== undefined) return held.through;
  const [made] = yield* unit.run(
    db.all<{ readonly thread_id: string }>(sql`insert into ${threadConversation} (thread_id) select ${threadId}
          where exists (select 1 from ${threadRecord} where ${threadRecord.id} = ${threadId}) on conflict do nothing
          returning thread_id`),
  );
  return made === undefined ? null : 0;
});

const mark = (
  db: Db,
  unit: Write,
  threadId: string,
  to: { readonly through?: number; readonly seen: number; readonly unreadable?: boolean },
) =>
  Effect.asVoid(
    unit.run(
      db
        .update(threadConversation)
        .set({
          through: to.through,
          seen: sql`max(${threadConversation.seen}, ${to.seen})`,
          unreadable: to.unreadable,
        })
        .where(eq(threadConversation.threadId, threadId)),
    ),
  );

const gap = (db: Db, unit: Write, threadId: string, entryId: string, runId: string | null) =>
  Effect.asVoid(
    unit.run(
      db
        .insert(threadMessageGap)
        .values({ threadId, entryId, runId })
        .onConflictDoUpdate({ target: [threadMessageGap.threadId, threadMessageGap.entryId], set: { runId } }),
    ),
  );

const closeGap = (db: Db, unit: Write, threadId: string, entryId: string) =>
  Effect.asVoid(
    unit.run(db.delete(threadMessageGap).where(and(eq(threadMessageGap.threadId, threadId), eq(threadMessageGap.entryId, entryId)))),
  );

const quiet = (db: Db, unit: Write, threadId: string, runId: string) =>
  Effect.map(
    unit.run(
      db
        .select({ runId: threadQuietRun.runId })
        .from(threadQuietRun)
        .where(and(eq(threadQuietRun.threadId, threadId), eq(threadQuietRun.runId, runId)))
        .get(),
    ),
    (row) => row !== undefined,
  );

const drop = (db: Db, unit: Write, key: string) =>
  Effect.asVoid(unit.run(db.run(sql`delete from ${threadMessage} where key = cast(${key} as integer)`)));

type Heard = {
  readonly entry_id: string;
  readonly position: number;
  readonly appeared: number;
  readonly run_id: string | null;
  readonly role: ConversationRole;
  readonly occurred_at: number;
  readonly rewound: string | null;
  readonly text: string;
};

const heardBy = Effect.fnUntraced(function* (db: Db, unit: Write, layer: BaseLayer, row: Heard) {
  const [seen] = yield* unit.run(
    db.all<{ readonly seen: number }>(sql`select
      not exists (select 1 from ${threadMessage} where ${threadMessage.threadId} = ${layer.threadId} and ${threadMessage.entryId} = ${row.entry_id})
      and (exists (select 1 from ${threadEntry} where ${threadEntry.threadId} = ${layer.threadId} and ${threadEntry.entryId} = ${row.entry_id})
        or exists (select 1 from ${threadEntry} where ${threadEntry.threadId} = ${layer.sourceId} and ${threadEntry.entryId} = ${row.entry_id}
          and ${threadEntry.ord} between ${layer.lowOrd} and ${layer.highOrd}
          and (${threadEntry.runId} is null or ${threadEntry.runId} not in (select value from json_each(${JSON.stringify(layer.hidden)})))))
      as seen`),
  );
  if (seen?.seen !== 1) return;
  const [born] = yield* unit.run(
    db.all<{
      readonly key: string;
    }>(sql`insert into ${threadMessage} (key, thread_id, entry_id, position, appeared, run_id, role, occurred_at, rewound, text)
      select coalesce(max(key) + 1, ${row.occurred_at} * ${BUCKET}), ${layer.threadId}, ${row.entry_id}, ${row.position}, ${row.appeared},
        ${row.run_id}, ${row.role}, ${row.occurred_at}, ${row.rewound}, ${row.text}
      from ${threadMessage} where key >= ${row.occurred_at} * ${BUCKET} and key < (${row.occurred_at} + 1) * ${BUCKET}
      having coalesce(max(key) + 1, ${row.occurred_at} * ${BUCKET}) < (${row.occurred_at} + 1) * ${BUCKET}
      returning cast(key as text) as key`),
  );
  if (born === undefined) return yield* gap(db, unit, layer.threadId, row.entry_id, row.run_id);
  yield* unit.run(db.run(sql`insert into ${fts}(rowid, text) values (cast(${born.key} as integer), ${projectionOf(row.text)})`));
});

const HEARD = sql`select entry_id, position, appeared, run_id, role, occurred_at, rewound, text from ${threadMessage}`;

const keepForBranches = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, rows: SQL) {
  const readers = yield* referrersOf(db, unit, threadId);
  if (readers.length === 0) return;
  const heard = yield* unit.run(db.all<Heard>(sql`${HEARD} where ${threadMessage.threadId} = ${threadId} and ${rows}`));
  for (const row of heard) {
    for (const layer of readers) {
      if (row.position <= layer.afterPosition || row.position > layer.throughPosition) continue;
      yield* heardBy(db, unit, layer, row);
    }
  }
});

export const conversationCopied = Effect.fnUntraced(function* (db: Db, unit: Write, layer: BaseLayer, from: number, to: number) {
  const heard = yield* unit.run(
    db.all<Heard>(sql`${HEARD} where ${threadMessage.threadId} = ${layer.sourceId}
      and ${threadMessage.position} > ${from} and ${threadMessage.position} <= ${to} order by ${threadMessage.position}`),
  );
  for (const row of heard) yield* heardBy(db, unit, layer, row);
  return heard.length;
});

const message = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, position: number, entry: Said, entryId: string) {
  yield* keepForBranches(db, unit, threadId, sql`${threadMessage.entryId} = ${entryId}`);
  const [standing] = yield* unit.run(
    db.all<Standing>(sql`select cast(${threadMessage.key} as text) as key, ${threadMessage.appeared} as appeared, ${threadMessage.occurredAt} as occurred_at,
          ${threadMessage.text} as text, ${threadMessage.rewound} as rewound
          from ${threadMessage} where ${threadMessage.threadId} = ${threadId} and ${threadMessage.entryId} = ${entryId}`),
  );
  const role = roleOf(entry.role);
  const runId = typeof entry.runId === 'string' ? entry.runId : null;
  const text = typeof entry.text === 'string' ? entry.text : '';
  const silent = role === 'agent' && runId !== null && (yield* quiet(db, unit, threadId, runId));
  const ms = typeof entry.occurredAt === 'string' ? Date.parse(entry.occurredAt) : Number.NaN;
  const dropped = role === null || silent || text.trim() === '' || !keyable(ms);
  const rewound = typeof entry.rewound?.by === 'string' ? entry.rewound.by : (standing?.rewound ?? null);
  if (standing !== undefined && (dropped || standing.text !== text || standing.rewound !== rewound)) {
    yield* voidCovered(db, unit, threadId, [standing]);
  }
  const unkeyed = role !== null && !silent && text.trim() !== '' && !keyable(ms);
  if (dropped) {
    if (standing !== undefined) yield* drop(db, unit, standing.key);
    yield* unkeyed ? gap(db, unit, threadId, entryId, runId) : closeGap(db, unit, threadId, entryId);
    return;
  }
  yield* closeGap(db, unit, threadId, entryId);
  const said = role as ConversationRole;
  if (standing !== undefined && standing.occurred_at === ms) {
    yield* unit.run(
      db.run(sql`update ${threadMessage} set position = ${position}, run_id = ${runId}, role = ${said}, rewound = ${rewound},
            text = ${text} where key = cast(${standing.key} as integer)`),
    );
    if (standing.text !== text) {
      yield* unit.run(db.run(sql`delete from ${fts} where rowid = cast(${standing.key} as integer)`));
      yield* unit.run(db.run(sql`insert into ${fts}(rowid, text) values (cast(${standing.key} as integer), ${projectionOf(text)})`));
    }
    return;
  }
  if (standing !== undefined) yield* drop(db, unit, standing.key);
  const [born] = yield* unit.run(
    db.all<{
      readonly key: string;
    }>(sql`insert into ${threadMessage} (key, thread_id, entry_id, position, appeared, run_id, role, occurred_at, rewound, text)
          select coalesce(max(key) + 1, ${ms} * ${BUCKET}), ${threadId}, ${entryId}, ${position}, ${standing?.appeared ?? position}, ${runId}, ${said}, ${ms}, ${rewound}, ${text}
          from ${threadMessage} where key >= ${ms} * ${BUCKET} and key < (${ms} + 1) * ${BUCKET}
          having coalesce(max(key) + 1, ${ms} * ${BUCKET}) < (${ms} + 1) * ${BUCKET}
          returning cast(key as text) as key`),
  );
  if (born === undefined) {
    yield* gap(db, unit, threadId, entryId, runId);
    return;
  }
  yield* unit.run(db.run(sql`insert into ${fts}(rowid, text) values (cast(${born.key} as integer), ${projectionOf(text)})`));
});

const place = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, event: IndexedEvent) {
  const facts = event.payload as Facts;
  if (facts.withdrawn !== undefined) {
    const runId = facts.withdrawn.runId;
    if (typeof runId !== 'string') return;
    yield* keepForBranches(db, unit, threadId, sql`${threadMessage.runId} = ${runId}`);
    const gone = yield* unit.run(
      db
        .delete(threadMessage)
        .where(and(eq(threadMessage.threadId, threadId), eq(threadMessage.runId, runId)))
        .returning({ appeared: threadMessage.appeared }),
    );
    yield* voidCovered(db, unit, threadId, gone);
    yield* unit.run(db.delete(threadMessageGap).where(and(eq(threadMessageGap.threadId, threadId), eq(threadMessageGap.runId, runId))));
    return;
  }
  if (facts.branched !== undefined) {
    const hidden = strings(facts.branched.hidden);
    const from = typeof facts.branched.from === 'string' ? facts.branched.from : null;
    const cut = sql`(${threadMessage.runId} in (select value from json_each(${JSON.stringify(hidden)}))
      or ${threadMessage.position} < (select floor.position from ${threadMessage} as floor
        where floor.thread_id = ${threadId} and floor.entry_id = ${from}))`;
    yield* keepForBranches(db, unit, threadId, cut);
    const gone = yield* unit.run(
      db
        .delete(threadMessage)
        .where(and(eq(threadMessage.threadId, threadId), cut))
        .returning({ appeared: threadMessage.appeared }),
    );
    yield* voidCovered(db, unit, threadId, gone);
    if (hidden.length > 0) {
      yield* unit.run(
        db.delete(threadMessageGap).where(and(eq(threadMessageGap.threadId, threadId), inArray(threadMessageGap.runId, [...hidden]))),
      );
    }
    return;
  }
  if (facts.rewound !== undefined) {
    const runIds = strings(facts.rewound.runIds);
    const by = facts.rewound.id;
    if (typeof by !== 'string' || runIds.length === 0) return;
    const marked = yield* unit.run(
      db
        .update(threadMessage)
        .set({ rewound: by })
        .where(and(eq(threadMessage.threadId, threadId), inArray(threadMessage.runId, [...runIds]), isNull(threadMessage.rewound)))
        .returning({ appeared: threadMessage.appeared }),
    );
    yield* voidCovered(db, unit, threadId, marked);
    return;
  }
  if (facts.restored !== undefined) {
    const runIds = strings(facts.restored.runIds);
    const by = facts.restored.rewindId;
    if (typeof by !== 'string' || runIds.length === 0) return;
    const restored = yield* unit.run(
      db
        .update(threadMessage)
        .set({ rewound: null })
        .where(and(eq(threadMessage.threadId, threadId), inArray(threadMessage.runId, [...runIds]), eq(threadMessage.rewound, by)))
        .returning({ appeared: threadMessage.appeared }),
    );
    yield* voidCovered(db, unit, threadId, restored);
    return;
  }
  const entry = facts.entry;
  if (entry?.type === 'signal' && entry.signalType === KEEP_WARM_SIGNAL_TYPE && typeof entry.runId === 'string') {
    yield* unit.run(db.insert(threadQuietRun).values({ threadId, runId: entry.runId }).onConflictDoNothing());
    yield* keepForBranches(db, unit, threadId, sql`${threadMessage.runId} = ${entry.runId} and ${threadMessage.role} = 'agent'`);
    yield* unit.run(
      db
        .delete(threadMessage)
        .where(and(eq(threadMessage.threadId, threadId), eq(threadMessage.runId, entry.runId), eq(threadMessage.role, 'agent'))),
    );
    yield* unit.run(
      db.delete(threadMessageGap).where(and(eq(threadMessageGap.threadId, threadId), eq(threadMessageGap.runId, entry.runId))),
    );
    return;
  }
  if (entry?.type === 'signal' && entry.signalType === USER_MESSAGE_SIGNAL_TYPE && typeof entry.id === 'string') {
    yield* message(db, unit, threadId, event.position, { ...entry, role: 'user' }, entry.id);
    return;
  }
  if (entry?.type === 'message' && typeof entry.id === 'string') yield* message(db, unit, threadId, event.position, entry, entry.id);
});

export const conversationMarked = (db: Db, program: ProgramUnit<'machine'>, threadId: string, at: number) =>
  Effect.andThen(
    program.write(
      db
        .update(threadConversation)
        .set({
          through: sql`case when ${threadConversation.through} = ${at - 1} then ${at} else ${threadConversation.through} end`,
          seen: sql`max(${threadConversation.seen}, ${at})`,
        })
        .where(eq(threadConversation.threadId, threadId)),
    ),
    program.write(
      db
        .insert(threadConversation)
        .values({ threadId, through: at === 1 ? 1 : 0, seen: at })
        .onConflictDoNothing(),
    ),
  );

export const conversationAppended = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, event: IndexedEvent) {
  const at = event.position;
  const moved = yield* unit.run(
    db
      .update(threadConversation)
      .set({
        through: sql`case when ${threadConversation.through} = ${at - 1} then ${at} else ${threadConversation.through} end`,
        seen: sql`max(${threadConversation.seen}, ${at})`,
      })
      .where(eq(threadConversation.threadId, threadId))
      .returning({ through: threadConversation.through })
      .get(),
  );
  if (moved === undefined) {
    yield* unit.run(
      db
        .insert(threadConversation)
        .values({ threadId, through: at === 1 ? 1 : 0, seen: at })
        .onConflictDoNothing(),
    );
    if (at !== 1) return;
  } else if (moved.through !== at) return;
  yield* place(db, unit, threadId, event);
});

export const conversationCarried = Effect.fnUntraced(function* (
  db: Db,
  unit: Write,
  threadId: string,
  from: number,
  to: number,
  events: readonly IndexedEvent[],
) {
  const through = yield* markOf(db, unit, threadId);
  if (through === null) return false;
  if (through < from) {
    yield* mark(db, unit, threadId, { seen: to });
    return false;
  }
  if (through >= to) return true;
  for (const event of events) if (event.position > through && event.position <= to) yield* place(db, unit, threadId, event);
  yield* mark(db, unit, threadId, { through: to, seen: to });
  return true;
});

export const conversationBehind = (db: Db, unit: Write, threadId: string, head: number, through = 0) =>
  Effect.asVoid(
    unit.run(
      db
        .insert(threadConversation)
        .values({ threadId, through, seen: head, unreadable: false })
        .onConflictDoUpdate({ target: threadConversation.threadId, set: { through, seen: head, unreadable: false } }),
    ),
  );

export const conversationInherited = (db: Db, unit: Write, layer: BaseLayer) =>
  Effect.asVoid(
    unit.run(
      db.run(sql`update ${threadMessage} set thread_id = ${layer.threadId}
        where ${threadMessage.threadId} = ${layer.sourceId}
          and ${threadMessage.position} > ${layer.afterPosition} and ${threadMessage.position} <= ${layer.throughPosition}
          and exists (select 1 from ${threadEntry} where ${threadEntry.threadId} = ${layer.threadId} and ${threadEntry.entryId} = ${threadMessage.entryId})
          and not exists (select 1 from ${threadMessage} as own where own.thread_id = ${layer.threadId} and own.entry_id = ${threadMessage.entryId})`),
    ),
  );

export const conversationUnreadable = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, head: number) {
  yield* markOf(db, unit, threadId);
  yield* mark(db, unit, threadId, { seen: head, unreadable: true });
});

export const conversationSettled = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string) {
  yield* markOf(db, unit, threadId);
  const caught = yield* unit.run(
    db
      .update(threadConversation)
      .set({ unreadable: false })
      .where(and(eq(threadConversation.threadId, threadId), sql`${threadConversation.through} >= ${threadConversation.seen}`))
      .returning({ through: threadConversation.through })
      .get(),
  );
  return caught !== undefined;
});

export const conversationSkipped = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string, to: number) {
  const through = yield* markOf(db, unit, threadId);
  yield* mark(db, unit, threadId, { through: Math.max(through ?? 0, to), seen: to, unreadable: true });
});

export const conversationCleared = Effect.fnUntraced(function* (db: Db, unit: Write, threadId: string) {
  yield* unit.run(db.delete(threadMessage).where(eq(threadMessage.threadId, threadId)));
  yield* unit.run(db.delete(threadMessageGap).where(eq(threadMessageGap.threadId, threadId)));
  yield* unit.run(db.delete(threadQuietRun).where(eq(threadQuietRun.threadId, threadId)));
  yield* unit.run(db.update(threadConversation).set({ through: 0, unreadable: false }).where(eq(threadConversation.threadId, threadId)));
});
