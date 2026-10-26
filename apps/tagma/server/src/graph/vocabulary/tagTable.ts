import { Effect, Layer, Option } from 'effect';
import { Tags } from '../contract/service/vocabulary.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { block, blockTag } from '../store/tables.js';
import { type TagTable } from '../contract/wire/tags/table.js';
import { TagIndex } from './tagIndex.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { ActState } from '../contract/service/transaction.js';
import { candidateOf } from './declarationRules.js';
import { namingOf } from './identity.js';
import { vocabularyRevision } from '../store/lawRevision.js';

export const tagsLayer: Layer.Layer<Tags, never, GraphStore | Behaviours | Catalogs> = Layer.effect(
  Tags,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const behaviours = yield* Behaviours;
    const shipped = yield* Catalogs;
    const committed = new Map<number, { revision: string; table: TagTable }>();
    const last = new Map<number, TagTable>();
    const built = new Map<number, TagIndex>();
    const BARE = new TagIndex([], behaviours, [], undefined, null, shipped);

    const resolve = Effect.fn('Tags.resolve')(function* (projectId: number) {
      const vocabularyRows = yield* db
        .select({ uuid: block.uuid, body: block.body, fields: block.fields, tags: block.tags })
        .from(block)
        .where(
          and(
            eq(block.projectId, projectId),
            isNull(block.deletedAt),
            sql`exists (select 1 from ${blockTag} t where t.block_id = ${block.id} and t.tag in (${TAG_DECLARATION.id}, ${CATALOG_DECLARATION.id}))`,
          ),
        )
        .orderBy(block.ord, block.id);
      const rows = vocabularyRows.filter((row) => row.tags.includes(TAG_DECLARATION.id));
      const catalogs = vocabularyRows.filter((row) => row.tags.includes(CATALOG_DECLARATION.id));
      const { naming, unreadable } = namingOf(rows, catalogs);
      const table = new TagIndex(rows.map(candidateOf), behaviours, unreadable, naming, built.get(projectId) ?? null, shipped);
      built.set(projectId, table);
      return table;
    });

    const of: Tags['Service']['of'] = Effect.fn('Tags.of')(function* (projectId: number) {
      const open = yield* Effect.serviceOption(ActState);
      if (Option.isSome(open)) {
        const unit = open.value;
        const own = unit.tables.get(projectId);
        if (own !== undefined) return own;
        if (!unit.vocabulary.has(projectId)) {
          const standing = committed.get(projectId);
          if (standing !== undefined && standing.revision === (yield* vocabularyRevision(db, projectId))) {
            unit.tables.set(projectId, standing.table);
            return standing.table;
          }
        }
        const resolved = yield* resolve(projectId);
        unit.tables.set(projectId, resolved);
        return resolved;
      }
      while (true) {
        const revision = yield* vocabularyRevision(db, projectId);
        const standing = committed.get(projectId);
        if (standing?.revision === revision) return standing.table;
        const table = yield* resolve(projectId);
        if ((yield* vocabularyRevision(db, projectId)) !== revision) continue;
        committed.set(projectId, { revision, table });
        last.set(projectId, table);
        return table;
      }
    });

    return Tags.of({
      of,

      reader: Effect.fn('Tags.reader')(function* (projectId: number) {
        yield* of(projectId);
        return () => last.get(projectId) ?? BARE;
      }),

      forget: Effect.fnUntraced(function* (projectId) {
        const open = yield* Effect.serviceOption(ActState);
        if (Option.isSome(open) && projectId !== undefined) {
          const unit = open.value;
          unit.vocabulary.add(projectId);
          unit.tables.delete(projectId);
          return;
        }
        if (projectId === undefined) committed.clear();
        else committed.delete(projectId);
      }),

      publish: (unit) =>
        Effect.sync(() => {
          for (const [projectId, table] of unit.tables) {
            if (unit.vocabulary.has(projectId)) continue;
            last.set(projectId, table);
          }
          for (const projectId of unit.vocabulary) committed.delete(projectId);
        }),
    });
  }),
);
