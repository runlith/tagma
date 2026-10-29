import { Effect } from 'effect';
import { and, eq, isNull } from 'drizzle-orm';
import type { Blocks } from '../contract/service/blocks.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { type PageRole, SCREEN_ROWS, pageRoleOf } from '../contract/wire/tags/pageRole.js';
import type { Crowded } from '../contract/wire/answers.js';
import { blockName } from '../contract/wire/references.js';
import { rests } from '../contract/wire/standing.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';

export type Placed = { readonly parentId: number | null; readonly tags: readonly string[] };

export const crowdedPages = Effect.fn('Blocks.crowded')(function* (
  blocks: Blocks['Service'],
  table: TagReading,
  placed: readonly Placed[],
) {
  const { db } = yield* GraphStore;
  const asked = new Map<number, Set<PageRole>>();
  for (const row of placed) {
    if (row.parentId === null) continue;
    const roles = asked.get(row.parentId) ?? new Set<PageRole>();
    roles.add(pageRoleOf(table, row));
    asked.set(row.parentId, roles);
  }
  const crowded: Crowded[] = [];
  for (const [parentId, roles] of asked) {
    const children = yield* db
      .select({ id: block.id, projectId: block.projectId, tags: block.tags, fields: block.fields })
      .from(block)
      .where(and(eq(block.parentId, parentId), isNull(block.deletedAt)));
    const candidates = children.filter((child) => roles.has(pageRoleOf(table, child)));
    if (candidates.length <= SCREEN_ROWS) continue;
    const counts = new Map<PageRole, number>();
    for (const child of yield* blocks.records(candidates, ['superseded', 'answered'])) {
      if (rests(table, child)) continue;
      const role = pageRoleOf(table, child);
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    const past = [...counts].filter(([, standing]) => standing > SCREEN_ROWS);
    if (past.length === 0) continue;
    const parent = yield* blocks.liveBlock(parentId);
    if (parent === undefined) continue;
    for (const [role, standing] of past) crowded.push({ parent: blockName(parent.uuid), title: parent.title, role, children: standing });
  }
  return crowded;
});
