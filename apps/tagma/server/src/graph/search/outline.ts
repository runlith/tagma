import { Effect } from 'effect';
import { inArray, sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { SubtreeShape } from '../contract/wire/standing.js';
import { block } from '../store/tables.js';
import { measuredCondition } from '../acts/measurement.js';
import { standingCondition } from '../work/standingCondition.js';

export const outlineRows = Effect.fn('Selection.outlineRows')(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  rootId: number,
  depth: number,
  all: boolean,
) {
  const walked = yield* db.all<{ id: number; parentId: number | null; visible: number }>(sql`
    with recursive outline(id, parent_id, depth, visible) as (
      select ${block.id}, null, 0, 1 from ${block} where ${block.id} = ${rootId}
      union all
      select ${block.id}, ${block.parentId}, o.depth + o.visible,
        case when ${all ? sql`1` : standingCondition(table)} then 1 else 0 end
      from ${block} join outline o on ${block.parentId} = o.id
      where ${block.deletedAt} is null and o.depth + o.visible <= ${depth}
    )
    select o.id, o.parent_id as parentId, o.visible from outline o join ${block} on ${block.id} = o.id
    order by ${block.ord}, ${block.id}
  `);
  const byParent = new Map<number, typeof walked>();
  for (const row of walked) {
    if (row.parentId === null) continue;
    const children = byParent.get(row.parentId);
    if (children === undefined) byParent.set(row.parentId, [row]);
    else children.push(row);
  }
  const children = new Map<number, number[]>();
  const pending = [{ id: rootId, parent: rootId, visible: 1 }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (next.id !== rootId && next.visible === 1) {
      const siblings = children.get(next.parent);
      if (siblings === undefined) children.set(next.parent, [next.id]);
      else siblings.push(next.id);
    }
    const nested = byParent.get(next.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const row = nested[index]!;
      pending.push({ id: row.id, parent: next.visible === 1 ? next.id : next.parent, visible: row.visible });
    }
  }
  return { ids: walked.filter((row) => row.visible === 1).map((row) => row.id), children };
});

export const subtreeShapes = Effect.fn('Selection.shapes')(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  rootId: number,
  ids: readonly number[],
) {
  const retired = measuredCondition(table).superseded;
  const selected = sql`not (${retired}) and ${inArray(block.id, [...ids])}`;
  const found = yield* db.all<{
    id: number;
    parent: number | null;
    offset: number;
    level: number;
    blocks: number;
    depth: number;
    widest: number;
  }>(sql`
    with recursive shape_tree(id, parent_id, retired, owner, owner_parent, offset, distance, level) as (
      select ${block.id}, null, 0, ${block.id}, null, 0, 0, 0 from ${block} where ${block.id} = ${rootId}
      union all
      select ${block.id}, case when s.retired then s.parent_id else s.id end,
        ${retired},
        case when ${selected} then ${block.id} else s.owner end,
        case when ${selected} then s.owner else s.owner_parent end,
        case when ${selected} then s.distance + 1 else s.offset end,
        case when ${selected} then 0 else s.distance + case when ${retired} then 0 else 1 end end,
        s.level + 1
      from ${block} join shape_tree s on ${block.parentId} = s.id
      where ${block.deletedAt} is null
    ), shelves as (
      select parent_id, count(*) as width from shape_tree where not retired and parent_id is not null group by parent_id
    ), parts as (
      select s.owner as id, s.owner_parent as parent, s.offset as offset, min(s.level) as level,
        count(*) - 1 as blocks, max(s.distance) as depth, coalesce(max(w.width), 0) as widest
      from shape_tree s left join shelves w on w.parent_id = s.id
      where not s.retired group by s.owner
    )
    select * from parts order by level desc
  `);
  const shapes = new Map<number, SubtreeShape>(ids.map((id) => [id, { blocks: 0, depth: 0, widest: 0 }]));
  for (const part of found) {
    const held = shapes.get(part.id)!;
    const shape = {
      blocks: held.blocks + part.blocks,
      depth: Math.max(held.depth, part.depth),
      widest: Math.max(held.widest, part.widest),
    };
    shapes.set(part.id, shape);
    if (part.parent === null) continue;
    const parent = shapes.get(part.parent)!;
    shapes.set(part.parent, {
      blocks: parent.blocks + shape.blocks + 1,
      depth: Math.max(parent.depth, part.offset + shape.depth),
      widest: Math.max(parent.widest, shape.widest),
    });
  }
  return shapes;
});
