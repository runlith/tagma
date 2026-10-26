import { Clock, Effect } from 'effect';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { CATALOG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { block, blockTag } from '../store/tables.js';

const stepping = writes('Tree.step.briefsLeave', [block]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutBrief = (profile: unknown): unknown => {
  if (!isRecord(profile) || !Object.hasOwn(profile, 'brief')) return profile;
  const { brief: _brief, ...kept } = profile;
  return kept;
};

export const briefsLeave = Effect.fn('GraphStep.briefsLeave')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({ id: block.id, fields: block.fields })
    .from(block)
    .where(
      and(
        eq(block.projectId, project.id),
        isNull(block.deletedAt),
        sql`exists (select 1 from ${blockTag} t where t.block_id = ${block.id} and t.tag = ${CATALOG_DECLARATION.id})`,
      ),
    );
  const changed = rows.flatMap((row) => {
    const { profile, release } = row.fields;
    const ownProfile = withoutBrief(profile);
    const releaseProfile = isRecord(release) ? withoutBrief(release.profile) : undefined;
    if (ownProfile === profile && (!isRecord(release) || releaseProfile === release.profile)) return [];
    const fields: Record<string, unknown> = { ...row.fields };
    if (profile !== undefined) fields.profile = ownProfile;
    if (isRecord(release) && release.profile !== undefined) fields.release = { ...release, profile: releaseProfile };
    return [{ id: row.id, fields }];
  });
  if (changed.length === 0) return;
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      yield* Effect.forEach(changed, (row) => db.update(block).set({ fields: row.fields, updatedAt: now }).where(eq(block.id, row.id)), {
        discard: true,
      });
    }),
  );
});
