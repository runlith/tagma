import { Clock, Effect } from 'effect';
import { and, eq, sql } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block, blockTag } from '../store/tables.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';

const stepping = writes('Tree.step.provenanceLeaves', [block]);

const discovery = (value: unknown): boolean =>
  value === 'discovered-from' || (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'discovered-from');

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutDiscovery = (value: Raw): Raw =>
  Array.isArray(value.edges) && value.edges.some(discovery) ? { ...value, edges: value.edges.filter((kind) => !discovery(kind)) } : value;

function migrated(fields: Raw): Raw {
  const declaration = withoutDiscovery(fields);
  const release = fields.release;
  if (!isRecord(release) || !Array.isArray(release.tags)) return declaration;
  const previous = release.tags;
  const tags = previous.map((tag) => (isRecord(tag) ? withoutDiscovery(tag) : tag));
  return tags.some((tag, index) => tag !== previous[index]) ? { ...declaration, release: { ...release, tags } } : declaration;
}

export const provenanceLeaves = Effect.fn('GraphStep.provenanceLeaves')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({ id: block.id, fields: block.fields })
    .from(block)
    .where(
      and(
        eq(block.projectId, project.id),
        sql`exists (select 1 from ${blockTag} t where t.block_id = ${block.id} and t.tag in (${TAG_DECLARATION.id}, ${CATALOG_DECLARATION.id}))`,
      ),
    );
  const changed = rows.flatMap(({ id, fields }) => {
    const next = migrated(fields);
    return next === fields ? [] : [{ id, fields: next }];
  });
  if (changed.length === 0) return;
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const row of changed) yield* db.update(block).set({ fields: row.fields, updatedAt: now }).where(eq(block.id, row.id));
    }),
  );
});
