import { Effect, Result } from 'effect';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { WriterRegister } from '../../../platform/contract/service/writers.js';
import { block, event } from '../../store/tables.js';
import { Tags } from '../../contract/service/vocabulary.js';
import type { BlockRow } from '../../contract/service/acts.js';
import type { ActedAfter, ActedBlock, HeldBlock, SessionWork, WorkBlock } from '../../contract/service/work.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import { SPEC } from '../../contract/wire/tags/spec.js';
import type { GraphEventOp } from '../../contract/wire/journal.js';
import { readJournal } from '../../contract/wire/journalPayloads.js';
import { blockName } from '../../contract/wire/references.js';
import { THREAD_ACTS, type ThreadAct } from '../../contract/wire/threadWork.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import { heldBy, standingWork } from './holding.js';

const ACTED: Readonly<Partial<Record<GraphEventOp, ThreadAct>>> = {
  create: 'created',
  update: 'edited',
  link: 'edited',
  unlink: 'edited',
  anchor: 'edited',
  unanchor: 'edited',
  relocate: 'edited',
  supersede: 'edited',
  unsupersede: 'edited',
  settle: 'edited',
  enable: 'edited',
  disable: 'edited',
  enforce: 'edited',
  accept: 'edited',
  reject: 'edited',
  uphold: 'edited',
  revise: 'edited',
  answer: 'edited',
  unanswer: 'edited',
  done: 'finished',
  close: 'closed',
};

const ACTED_OPS = Object.keys(ACTED) as GraphEventOp[];

const ENDING_OPS: readonly GraphEventOp[] = ['done', 'close'];

const META = {
  id: block.id,
  uuid: block.uuid,
  parentId: block.parentId,
  title: block.title,
  tags: block.tags,
  fields: block.fields,
  deletedAt: block.deletedAt,
};

type Meta = Pick<BlockRow, keyof typeof META>;

const workBlock = (table: TagTable, row: Meta): WorkBlock => ({
  name: blockName(row.uuid),
  title: row.title,
  tags: row.tags,
  status: table.statusOf(row),
});

export const sessionWork = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const sessions = yield* WriterRegister;
  const vocabulary = yield* Tags;

  const specsOf = Effect.fn('Tasks.specsOf')(function* (table: TagTable, rows: readonly Meta[]) {
    const within = rows.flatMap((row) => (row.parentId === null ? [] : [row.id]));
    const specs = new Map<number, HeldBlock['spec']>();
    if (within.length === 0) return specs;
    const chain = yield* db.all<{ start: number; id: number; depth: number }>(sql`
      with recursive up(start, id, depth) as (
        select ${block.id}, ${block.parentId}, 1 from ${block} where ${inArray(block.id, within)}
        union all
        select up.start, b.parent_id, up.depth + 1 from up join ${block} b on b.id = up.id where b.parent_id is not null
      )
      select start, id, depth from up where id is not null
    `);
    if (chain.length === 0) return specs;
    const ancestors = new Map(
      (yield* db
        .select(META)
        .from(block)
        .where(inArray(block.id, [...new Set(chain.map((link) => link.id))]))).map((row) => [row.id, row] as const),
    );
    for (const link of [...chain].sort((a, b) => a.depth - b.depth)) {
      if (specs.has(link.start)) continue;
      const parent = ancestors.get(link.id);
      if (parent !== undefined && table.supports(parent, SPEC))
        specs.set(link.start, { name: blockName(parent.uuid), title: parent.title, tags: parent.tags });
    }
    return specs;
  });

  const heldWork = Effect.fn('Tasks.heldWork')(function* (table: TagTable, projectId: number, from: number) {
    const rows = yield* db
      .select(META)
      .from(block)
      .where(and(standingWork(table, projectId), heldBy(table, from)))
      .orderBy(asc(block.createdAt), asc(block.id));
    const specs = yield* specsOf(table, rows);
    return rows.map((row): HeldBlock => ({ ...workBlock(table, row), spec: specs.get(row.id) ?? null }));
  });

  const acted = Effect.fn('Tasks.acted')(function* (
    table: TagTable,
    projectId: number,
    from: number,
    after: ActedAfter | undefined,
    rows: number,
  ): Effect.fn.Return<{ readonly did: readonly ActedBlock[]; readonly total: number }, StoreFailure> {
    const mine = and(eq(event.sessionId, from), inArray(event.op, ACTED_OPS), eq(block.projectId, projectId));
    const lastId = sql<number>`max(${event.id})`;
    const at = sql<number>`max(${event.ts})`;
    const page = yield* db
      .select({ blockId: block.id, lastId, at, groups: sql<number>`count(*) over ()` })
      .from(event)
      .innerJoin(block, eq(block.id, event.blockId))
      .where(mine)
      .groupBy(block.id)
      .having(after === undefined ? undefined : sql`${at} < ${after.at} or (${at} = ${after.at} and ${lastId} < ${after.lastId})`)
      .orderBy(desc(at), desc(lastId))
      .limit(rows);
    const total =
      after === undefined
        ? (page[0]?.groups ?? 0)
        : ((yield* db
            .select({ total: sql<number>`count(distinct ${event.blockId})` })
            .from(event)
            .innerJoin(block, eq(block.id, event.blockId))
            .where(mine)
            .get())?.total ?? 0);
    if (page.length === 0) return { did: [], total };
    const ids = page.map((row) => row.blockId);
    const rowsById = new Map((yield* db.select(META).from(block).where(inArray(block.id, ids))).map((row) => [row.id, row] as const));
    const kinds = yield* db
      .select({ blockId: event.blockId, op: event.op, lastId })
      .from(event)
      .where(and(eq(event.sessionId, from), inArray(event.op, ACTED_OPS), inArray(event.blockId, ids)))
      .groupBy(event.blockId, event.op);
    const ops = new Map<number, { op: GraphEventOp; lastId: number }[]>();
    for (const kind of kinds) {
      if (kind.blockId === null) continue;
      ops.set(kind.blockId, [...(ops.get(kind.blockId) ?? []), { op: kind.op, lastId: kind.lastId }]);
    }
    const endingIds = [...ops.values()].flatMap((own) => {
      const ending = own.filter((one) => ENDING_OPS.includes(one.op)).sort((a, b) => b.lastId - a.lastId)[0];
      return ending === undefined ? [] : [ending.lastId];
    });
    const endings =
      endingIds.length === 0
        ? []
        : yield* db
            .select({ id: event.id, op: event.op, payload: event.payload, blockId: event.blockId })
            .from(event)
            .where(inArray(event.id, endingIds));
    const commits = new Map(
      endings.flatMap((entry) => {
        if (entry.blockId === null) return [];
        const read = readJournal.ending(entry);
        const ending = Result.isSuccess(read)
          ? { commit: read.success.commit ?? null, commitUnread: null }
          : { commit: null, commitUnread: read.failure.message };
        return [[entry.blockId, ending] as const];
      }),
    );
    const did = page.flatMap((acting): ActedBlock[] => {
      const row = rowsById.get(acting.blockId);
      const own = ops.get(acting.blockId) ?? [];
      const newest = own.reduce<{ op: GraphEventOp; lastId: number } | undefined>(
        (best, one) => (best === undefined || one.lastId > best.lastId ? one : best),
        undefined,
      );
      const last = newest === undefined ? undefined : ACTED[newest.op];
      if (row === undefined || last === undefined) return [];
      const done = new Set(own.flatMap((one) => (ACTED[one.op] === undefined ? [] : [ACTED[one.op]])));
      return [
        {
          ...workBlock(table, row),
          acts: THREAD_ACTS.filter((word) => done.has(word)),
          last,
          at: acting.at,
          lastId: acting.lastId,
          commit: commits.get(acting.blockId)?.commit ?? null,
          commitUnread: commits.get(acting.blockId)?.commitUnread ?? null,
          trashed: row.deletedAt !== null,
        },
      ];
    });
    return { did, total };
  });

  const workOf = Effect.fn('Tasks.workOf')(function* (input: {
    readonly projectId: number;
    readonly from: SessionRef;
    readonly after: ActedAfter | undefined;
    readonly rows: number;
  }): Effect.fn.Return<SessionWork, StoreFailure> {
    const from = yield* sessions.idOf(input.from);
    if (from === null) return { held: [], did: [], total: 0 };
    const table = yield* vocabulary.of(input.projectId);
    const held = yield* heldWork(table, input.projectId, from);
    const { did, total } = yield* acted(table, input.projectId, from, input.after, input.rows);
    return { held, did, total };
  });

  return { workOf };
});
