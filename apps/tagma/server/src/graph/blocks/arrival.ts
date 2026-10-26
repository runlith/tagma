import { Clock, Effect } from 'effect';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writes } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import { pagesOf } from '../../platform/store/binds.js';
import { block, farEdge } from '../store/tables.js';
import { linking, placing, projecting, referencing } from '../store/actWrites.js';
import { Act, BlockProjection, BlockReferences, type BlockRow, type BlockWrite } from '../contract/service/acts.js';
import { type Arrival, type ArrivalRefusal, type CarriedBlock, Edges } from '../contract/service/blocks.js';
import { Sources } from '../contract/service/sources.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { AMENDMENT } from '../contract/wire/tags/amendment.js';
import { LEAF } from '../contract/wire/tags/leaf.js';
import { blockName } from '../contract/wire/references.js';
import { farText } from '../contract/wire/far.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { BlockRows } from '../acts/rows.js';
import { transactionUnit } from '../acts/state.js';
import { assertComposable, assertRequiredFields, validateFields } from '../vocabulary/declarationRules.js';
import { fieldTargetGuard } from '../vocabulary/carriers.js';
import { assertRequiredSources } from '../sources/readers/place.js';
import { assertBodyCap, leafRefusal } from './guards.js';

const arriving = writes('Blocks.arrive', [block, session], projecting, referencing, linking, placing);

const renamed = <Code extends string>(name: string, refused: GateRefusal<Code>): GateRefusal<Code> =>
  new GateRefusal(refused.code, `${name}: ${refused.reason}`, refused.unblock);

const undeclared = (shipped: Catalogs['Service'], table: TagTable, missing: readonly string[]): GateRefusal<'tag-undeclared'> => {
  const switching = missing.flatMap((id) => {
    const by = shipped.declaring(id);
    return by.length === 0 ? [] : [`#${id} is declared by the ${by.join(' and ')} catalog: switch it on with write_setting graph.catalogs`];
  });
  return new GateRefusal(
    'tag-undeclared',
    `this project declares no ${missing.map((id) => `#${id}`).join(', ')}, and the moving blocks carry it`,
    [
      `create_block with tags: ['${TAG_DECLARATION.id}'] declares a tag of your own, checked and gated like any other`,
      ...switching,
      `the tags this project declares: ${table
        .declaredTags()
        .map((id) => `#${id}`)
        .join(', ')}`,
    ],
  );
};

export const blockArrival = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const references = yield* BlockReferences;
  const rows = yield* BlockRows;
  const edges = yield* Edges;
  const sources = yield* Sources;
  const writers = yield* WriterRegister;
  const vocabulary = yield* Tags;
  const shipped = yield* Catalogs;
  const assertFieldTargets = yield* fieldTargetGuard;

  const typed = Effect.fnUntraced(function* (table: TagTable, blocks: readonly CarriedBlock[]) {
    const keyed = new Map(blocks.map((one) => [one.uuid, one.tags.map((word) => table.identities.keyOf(word) ?? word)] as const));
    const missing = [...new Set([...keyed.values()].flat())].filter((id) => table.tagById(id) === null);
    if (missing.length > 0) return yield* undeclared(shipped, table, missing);
    const tags = new Map<string, Tag[]>();
    for (const one of blocks) {
      const ids = keyed.get(one.uuid) ?? [];
      const name = blockName(one.uuid);
      if (ids.includes(TAG_DECLARATION.id) || ids.includes(CATALOG_DECLARATION.id)) {
        return yield* new GateRefusal(
          'relocation-shape',
          `${name} declares vocabulary, and a declaration holds the nodes of its own graph`,
          [`leave ${name} where it stands: in the new graph its tags come from a catalog or a #${TAG_DECLARATION.id} of its own`],
        );
      }
      const declared = ids.flatMap((id) => table.tagById(id) ?? []);
      yield* assertComposable(declared).pipe(Effect.mapError((refused) => renamed(name, refused)));
      yield* assertBodyCap(declared, one.body).pipe(Effect.mapError((refused) => renamed(name, refused)));
      tags.set(one.uuid, declared);
    }
    return { keyed, tags };
  });

  return Effect.fn('Blocks.arrive')(function* (input: Arrival): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<ArrivalRefusal>> {
    const table = yield* vocabulary.of(input.projectId);
    const { keyed, tags } = yield* typed(table, input.blocks);
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      arriving,
      Effect.gen(function* () {
        const parent = yield* rows.blockById(input.parentId);
        const graph = (yield* rows.rootBlockOf(input.projectId)).uuid;
        for (const page of pagesOf(
          input.blocks.map((one) => one.uuid),
          1,
        )) {
          const resting = yield* db
            .select({ id: block.id })
            .from(block)
            .where(and(inArray(block.uuid, page), isNotNull(block.deletedAt)));
          for (const { id } of resting) yield* db.update(block).set({ uuid: mintBlockId() }).where(eq(block.id, id));
        }
        const born = new Map<string, BlockRow>();
        for (const one of input.blocks) {
          const name = blockName(one.uuid);
          const above = one.parent === null ? parent : born.get(one.parent);
          if (above === undefined) return yield* Effect.die(`${name} arrived before its parent ${one.parent}`);
          const ids = keyed.get(one.uuid) ?? [];
          const declared = tags.get(one.uuid) ?? [];
          if (!table.supports({ tags: ids }, AMENDMENT) && table.supports(above, LEAF)) return yield* leafRefusal(blockName(above.uuid));
          const fields: Record<string, unknown> = { ...one.fields };
          for (const { field, writer } of one.sessions) fields[field] = (yield* writers.resolve(yield* transactionUnit, writer)).id;
          yield* validateFields(declared, fields).pipe(Effect.mapError((refused) => renamed(name, refused)));
          yield* assertRequiredFields(declared, fields).pipe(Effect.mapError((refused) => renamed(name, refused)));
          const row = yield* db
            .insert(block)
            .values({
              uuid: one.uuid,
              projectId: input.projectId,
              parentId: above.id,
              ord: one.parent === null ? yield* rows.nextOrd(above.id) : one.ord,
              tags: ids,
              fields,
              title: one.title,
              body: one.body,
              createdAt: one.createdAt,
              updatedAt: one.updatedAt,
            })
            .returning()
            .get();
          if (row === undefined) return yield* Effect.die('block insert returned no row');
          yield* projection.syncBorn(row, one.sources.length === 0);
          yield* act.record('create', row, { kind: table.tagOf(row)?.id ?? null, chars: row.body.length }, now);
          born.set(one.uuid, row);
        }
        for (const one of input.blocks) {
          const row = born.get(one.uuid) as BlockRow;
          const name = blockName(one.uuid);
          const declared = tags.get(one.uuid) ?? [];
          yield* references.syncRefs(row.id, row.body, { projectId: input.projectId });
          yield* assertFieldTargets(table, input.projectId, declared, row.fields).pipe(
            Effect.catchTag('GateRefusal', (refused) => Effect.fail(renamed(name, refused))),
          );
          for (const source of one.sources) {
            yield* sources.place(row, source).pipe(Effect.catchTag('GateRefusal', (refused) => Effect.fail(renamed(name, refused))));
          }
          yield* assertRequiredSources(declared, one.sources, 'anchor it over the place it stands for before the move').pipe(
            Effect.mapError((refused) => renamed(name, refused)),
          );
          for (const link of one.links) {
            const to = born.get(link.to) as BlockRow;
            yield* edges.assertCarried(row, link.kind, to);
            yield* rows.insertEdge(row.id, link.kind, to.id);
          }
          for (const link of one.far) {
            if (link.target.graph !== graph) {
              yield* edges.assertCarried(row, link.kind, link.end);
              yield* rows.insertFarEdge(row.id, link.kind, link.target);
              continue;
            }
            const here = yield* db
              .select()
              .from(block)
              .where(and(eq(block.uuid, link.target.uuid), eq(block.projectId, input.projectId), isNull(block.deletedAt)))
              .get();
            if (here === undefined) {
              return yield* new GateRefusal(
                'relocation-shape',
                `${name} ${link.kind} ${blockName(link.target.uuid)} names a block of this graph, and this graph does not hold it`,
                [`unlink_blocks ${name} ${link.kind} ${blockName(link.target.uuid)} before the move`],
              );
            }
            yield* edges.assertCarried(row, link.kind, here);
            yield* rows.insertEdge(row.id, link.kind, here.id);
          }
        }
        for (const page of pagesOf([...born.keys()], 1)) {
          const pointing = yield* db
            .select({ row: farEdge })
            .from(farEdge)
            .innerJoin(block, eq(block.id, farEdge.fromId))
            .where(and(eq(block.projectId, input.projectId), eq(farEdge.graph, input.from), inArray(farEdge.uuid, page)));
          for (const { row: far } of pointing) {
            const to = born.get(far.uuid) as BlockRow;
            yield* edges.assertCarried(yield* rows.rawBlockById(far.fromId), far.kind, to);
            yield* db
              .delete(farEdge)
              .where(
                and(eq(farEdge.fromId, far.fromId), eq(farEdge.kind, far.kind), eq(farEdge.graph, far.graph), eq(farEdge.uuid, far.uuid)),
              );
            yield* act.record('unlink', far.fromId, { kind: far.kind, far: farText(far) }, now);
            yield* rows.insertEdge(far.fromId, far.kind, to.id);
          }
        }
        const root = born.get(input.blocks[0]?.uuid ?? '');
        if (root === undefined) return yield* Effect.die('an arrival carries no blocks');
        return yield* rows.written(root, false);
      }),
    );
  });
});
