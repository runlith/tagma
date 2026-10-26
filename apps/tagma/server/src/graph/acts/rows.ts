import { Context, Effect } from 'effect';
import { blockName } from '../contract/wire/references.js';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { block, blockTag, edge } from '../store/tables.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type BlockReferences, type BlockRow, MEASURED_FACTS } from '../contract/service/acts.js';
import type { Blocks, Edges } from '../contract/service/blocks.js';

export function likeLiteral(value: string): string {
  return value.replaceAll(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}

type BlockReads = Blocks['Service'];

export class BlockRows extends Context.Service<
  BlockRows,
  Pick<
    BlockReads,
    | 'liveBlock'
    | 'blockById'
    | 'rawBlockById'
    | 'rootBlockOf'
    | 'childrenOf'
    | 'collectDescendants'
    | 'nextOrd'
    | 'recordOf'
    | 'details'
    | 'written'
    | 'records'
  > &
    Pick<Edges['Service'], 'insertEdgeRow' | 'insertEdge' | 'insertFarEdge'> & {
      isSuperseded(id: number): Effect.Effect<boolean, StoreFailure>;
      supersedesReaches(from: number, to: number): Effect.Effect<boolean, StoreFailure>;
      successorOf(id: number): Effect.Effect<number | null, StoreFailure>;
    }
>()('tagma/graph/BlockRows') {}

export function blockRows(
  db: GraphStore['Service']['db'],
  records: BlockReads['records'],
  refsIn: BlockReferences['Service']['refsIn'],
  recorded: Pick<BlockRows['Service'], 'insertEdgeRow' | 'insertEdge' | 'insertFarEdge'>,
): BlockRows['Service'] {
  const details: BlockReads['details'] = Effect.fn('Act.details')(function* <TRow extends BlockRow>(rows: readonly TRow[]) {
    return yield* records(rows, MEASURED_FACTS);
  });

  const recordOf = Effect.fn('Act.recordOf')(function* (row: BlockRow) {
    const [only] = yield* details([row]);
    if (!only) return yield* Effect.die('record projection returned nothing');
    return only;
  });

  const written = Effect.fn('Act.written')(function* (row: BlockRow, textMoved: boolean) {
    return { ...(yield* recordOf(row)), refsIn: textMoved ? yield* refsIn(row.id) : [] };
  });

  const rawBlockById = Effect.fn('Act.rawBlockById')(function* (
    id: number,
  ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<'not-found'>> {
    const row = yield* db.select().from(block).where(eq(block.id, id)).get();
    if (!row) {
      return yield* new GateRefusal('not-found', 'that block does not exist', [
        'search_blocks — find the block by its words and read its name',
        'a block that was here and is not is resting in the trash: restore_block on a name that is not a batch root answers with every root that is',
      ]);
    }
    return row;
  });

  const childrenOf = Effect.fn('Act.childrenOf')(function* (parentId: number) {
    return yield* db
      .select()
      .from(block)
      .where(and(eq(block.parentId, parentId), isNull(block.deletedAt)))
      .orderBy(block.ord);
  });

  return BlockRows.of({
    liveBlock: Effect.fn('Act.liveBlock')(function* (id: number) {
      const row = yield* db.select().from(block).where(eq(block.id, id)).get();
      return row === undefined || row.deletedAt !== null ? undefined : row;
    }),

    blockById: Effect.fn('Act.blockById')(function* (
      id: number,
    ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<'not-found' | 'deleted'>> {
      const row = yield* rawBlockById(id);
      if (row.deletedAt !== null) {
        const name = blockName(row.uuid);
        return yield* new GateRefusal('deleted', `block ${name} is in the trash`, [`restore_block ${name}`]);
      }
      return row;
    }),

    rawBlockById,

    rootBlockOf: Effect.fn('Act.rootBlockOf')(function* (
      projectId: number,
    ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<'no-root'>> {
      const row = yield* db
        .select()
        .from(block)
        .where(
          and(
            eq(block.projectId, projectId),
            isNull(block.parentId),
            sql`not exists (select 1 from ${blockTag} t where t.block_id = ${block.id})`,
            isNull(block.deletedAt),
          ),
        )
        .get();
      if (!row) {
        return yield* new GateRefusal('no-root', `project ${projectId} has no root block`, [
          'the root is born with the project, so it can only be resting in the trash',
        ]);
      }
      return row;
    }),

    childrenOf,

    collectDescendants: Effect.fn('Act.collectDescendants')(function* (id: number) {
      const result: BlockRow[] = [];
      const queue = [id];
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) break;
        for (const child of yield* childrenOf(next)) {
          result.push(child);
          queue.push(child.id);
        }
      }
      return result;
    }),

    nextOrd: Effect.fn('Act.nextOrd')(function* (parentId: number | null) {
      const rows = yield* db
        .select({ max: sql<number | null>`max(${block.ord})` })
        .from(block)
        .where(parentId === null ? isNull(block.parentId) : eq(block.parentId, parentId));
      return (rows[0]?.max ?? 0) + 1;
    }),

    recordOf,
    details,
    written,
    records,
    insertEdgeRow: recorded.insertEdgeRow,
    insertEdge: recorded.insertEdge,
    insertFarEdge: recorded.insertFarEdge,

    isSuperseded: Effect.fn('Act.isSuperseded')(function* (id: number) {
      const rows = yield* db
        .select({ id: edge.fromId })
        .from(edge)
        .where(and(eq(edge.kind, 'supersedes'), eq(edge.toId, id)));
      return rows.length > 0;
    }),

    supersedesReaches: Effect.fn('Act.supersedesReaches')(function* (from: number, to: number) {
      const rows = yield* db.all<{ id: number }>(sql`
        with recursive chain(id) as (
          select ${from}
          union
          select e.to_id from ${edge} e join chain c on e.from_id = c.id and e.kind = 'supersedes'
        )
        select id from chain where id = ${to}
      `);
      return rows.length > 0;
    }),

    successorOf: Effect.fn('Act.successorOf')(function* (id: number) {
      const row = yield* db
        .select({ id: edge.fromId })
        .from(edge)
        .where(and(eq(edge.kind, 'supersedes'), eq(edge.toId, id)))
        .get();
      return row?.id ?? null;
    }),
  });
}
