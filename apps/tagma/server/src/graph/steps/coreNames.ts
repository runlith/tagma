import { and, eq, like, or, sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Act, BlockProjection } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { block, blockTag } from '../store/tables.js';
import { projecting } from '../store/actWrites.js';
import { type Change, each, keys, openChildren, properties, type Raw, refFields, storedFields } from './documents.js';

const stepping = writes('Tree.step.coreNames', [block, blockTag], projecting);
const contract: Change = (value) => (typeof value === 'string' && value.startsWith('lode/') ? `core/${value.slice(5)}` : value);
const reference: Change = (value) =>
  typeof value === 'string' && value.startsWith('shipped:lode/') ? `shipped:core/${value.slice('shipped:lode/'.length)}` : value;
const library: Change = (value) => (value === 'lode' ? 'core' : value);
const fieldName = (key: string): string => reference(key) as string;
const selector = properties({ types: each(reference), contract });
const profile = properties({
  defaults: each(properties({ contract, type: reference })),
  batch: each(properties({ type: reference })),
});
const declaration = properties({
  extends: reference,
  fields: refFields(reference),
  contracts: keys((key) => contract(key) as string),
  gates: each(openChildren(reference)),
  edges: each(properties({ to: each(reference) })),
  identity: properties({ shipped: properties({ library }) }),
  layer: properties({ type: reference }),
  fork: properties({ library }),
});
const release = properties({
  tags: each(declaration),
  profile,
  transfers: each(properties({ was: properties({ library }) })),
  forks: each(properties({ type: reference })),
});
const query = properties({ tags: each(reference), selector, fields: keys(fieldName) });
const documents: Readonly<Record<string, Change>> = {
  tagExtends: reference,
  tagContracts: keys((key) => contract(key) as string),
  tagFields: (value) => (declaration({ fields: value }) as Raw).fields,
  tagGates: (value) => (declaration({ gates: value }) as Raw).gates,
  tagEdges: (value) => (declaration({ edges: value }) as Raw).edges,
  tagIdentity: properties({ shipped: properties({ library }) }),
  keyedLayer: properties({ type: reference }),
  typeFork: properties({ library }),
  catalogRelease: release,
  catalogProfile: profile,
  blockQuery: query,
};
export const coreNames = Effect.fn('GraphStep.coreNames')(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const vocabulary = yield* Tags;
  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(block)
        .where(and(eq(block.projectId, project.id), or(like(block.fields, '%lode%'), like(block.tags, '%shipped:lode/%'))));
      const changed = new Set<number>();
      const now = new Date(yield* Clock.currentTimeMillis);
      const save = Effect.fnUntraced(function* (row: (typeof rows)[number], fields: Raw, tags = row.tags) {
        if (JSON.stringify(tags) === JSON.stringify(row.tags) && JSON.stringify(fields) === JSON.stringify(row.fields)) return;
        yield* db.update(block).set({ fields, tags, updatedAt: now }).where(eq(block.id, row.id));
        row.fields = fields;
        row.tags = tags;
        row.updatedAt = now;
        changed.add(row.id);
      });
      for (const row of rows) {
        if (row.tags.includes(TAG_DECLARATION.id)) yield* save(row, declaration(row.fields) as Raw);
        if (row.tags.includes(CATALOG_DECLARATION.id)) {
          const fields = properties({ id: library, release, profile })(row.fields) as Raw;
          yield* save(row, fields);
        }
      }
      yield* projection.derive([...changed], ['tags']);
      yield* vocabulary.forget(project.id);
      const table = yield* vocabulary.of(project.id);
      const fieldsOf = storedFields(table, documents, fieldName);
      for (const row of rows) {
        const tags = row.tags.map((tag) => reference(tag) as string);
        yield* save(row, fieldsOf(table.tagsOf({ tags }), row.fields), tags);
      }
      yield* projection.derive([...changed], ['tags']);
      yield* db
        .update(blockTag)
        .set({ typeId: sql`replace(${blockTag.typeId}, 'shipped:lode/', 'shipped:core/')` })
        .where(
          and(
            like(blockTag.typeId, 'shipped:lode/%'),
            sql`${blockTag.blockId} in (select ${block.id} from ${block} where ${block.projectId} = ${project.id})`,
          ),
        );
    }),
  );
});
