import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { storeLayer } from '../../../../platform/store/open.js';
import { writes } from '../../../../platform/contract/service/writes.js';
import { project } from '../../../../projects/store/table.js';
import { block, blockField, blockTag, event, meta, searchIndex } from '../../../../graph/store/tables.js';
import { tagsLayer } from '../../../../graph/vocabulary/tagTable.js';
import { Catalogs, NO_CATALOGS } from '../../../../graph/contract/wire/catalogs.js';
import { Tags } from '../../../../graph/contract/service/vocabulary.js';
import { Behaviours } from '../../../../graph/contract/service/behaviours.js';
import { blockProjection } from '../../../../graph/acts/derived.js';
import { actUnit } from '../../../../graph/acts/unit.js';
import { CORE_LIBRARY, localTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';

const DECLARATION = '0198aaaa-0000-7000-8000-00000000a001';
const CARRIER = '0198aaaa-0000-7000-8000-00000000b002';

layer(BunFileSystem.layer, { excludeTestServices: true })('type storage', (it) => {
  it.effect('derived type ids rebuild atomically without changing nodes or history', () =>
    Effect.gen(function* () {
      const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-type-storage-' });
      const path = join(root, 'graph.sqlite');
      const now = new Date(1000);
      const permanent = localTypeId(DECLARATION.replaceAll('-', ''));
      const carried = ['note', permanent, 'alias', 'missing'];
      const before = yield* Effect.gen(function* () {
        const { db } = yield* GraphStore;
        yield* db.insert(project).values({ id: 1, name: 'stored', repoKey: 'stored', rootPath: root, createdAt: now });
        yield* db.insert(block).values([
          {
            id: 1,
            uuid: DECLARATION,
            projectId: 1,
            ord: 1,
            title: 'A local type',
            tags: ['tag'],
            fields: { id: 'note', identity: { name: 'alias' } },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 2,
            uuid: CARRIER,
            projectId: 1,
            parentId: 1,
            ord: 1,
            title: 'An existing carrier',
            tags: carried,
            fields: { enforcement: { revision: 'kept', state: 'adopted' } },
            createdAt: now,
            updatedAt: now,
          },
        ]);
        for (const [blockId, words] of [
          [1, ['tag']],
          [2, carried],
        ] as const) {
          for (const tag of words) yield* db.run(sql`insert into block_tag (block_id, tag) values (${blockId}, ${tag})`);
        }
        yield* db.insert(searchIndex).values([
          { blockId: 1, text: 'A local type' },
          { blockId: 2, text: 'An existing carrier' },
        ]);
        yield* db.insert(event).values({ ts: now, op: 'create', blockId: 2, projectId: 1, payload: '{"verdict":"kept"}' });
        return { blocks: yield* db.select().from(block), history: yield* db.select().from(event) };
      }).pipe(Effect.provide(storeLayer(GraphStore, path, fixtureGraphMigrations, { readers: 1 })));
      const context = yield* Layer.build(
        tagsLayer.pipe(
          Layer.provideMerge(storeLayer(GraphStore, path, fixtureGraphMigrations, { readers: 1 })),
          Layer.provide(Layer.succeed(Behaviours, BEHAVIOUR_REGISTRY)),
          Layer.provide(Layer.succeed(Catalogs, NO_CATALOGS)),
        ),
      );
      const store = Context.get(context, GraphStore);
      const tags = Context.get(context, Tags);
      const unit = actUnit(store, tags);
      const projection = blockProjection(store.db, tags, unit);
      const marker = () => store.db.select().from(meta).where(eq(meta.key, 'type-index-pending')).get();
      expect(yield* marker()).toEqual({ key: 'type-index-pending', value: '1' });
      expect((yield* store.db.select().from(blockTag)).every((row) => row.typeId === null)).toBe(true);
      yield* store.db.run(
        sql`create trigger fail_type_backfill before update of type_id on block_tag begin select raise(abort, 'backfill failed'); end`,
      );
      expect((yield* Effect.result(projection.completeDerived()))._tag).toBe('Failure');
      expect(yield* marker()).toEqual({ key: 'type-index-pending', value: '1' });
      expect((yield* store.db.select().from(blockTag)).every((row) => row.typeId === null)).toBe(true);
      yield* store.db.run(sql`drop trigger fail_type_backfill`);
      yield* projection.completeDerived();
      expect(yield* marker()).toBeUndefined();
      expect(yield* store.db.select().from(blockTag).orderBy(blockTag.blockId, blockTag.tag)).toEqual([
        { blockId: 1, tag: 'tag', typeId: `shipped:${CORE_LIBRARY}/tag` },
        ...carried.toSorted().map((tag) => ({ blockId: 2, tag, typeId: tag === 'note' || tag === permanent ? permanent : null })),
      ]);
      expect(yield* store.db.select().from(block)).toEqual(before.blocks);
      expect(yield* store.db.select().from(event)).toEqual(before.history);
      const declaring = writes('test.declaration', [block, blockTag, blockField]);
      const declare = Effect.gen(function* () {
        const [row] = yield* store.db
          .insert(block)
          .values({
            id: 3,
            uuid: '0198aaaa-0000-7000-8000-00000000c003',
            projectId: 1,
            parentId: 1,
            ord: 2,
            title: 'A late declaration',
            tags: ['tag'],
            fields: { id: 'missing' },
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) return yield* Effect.die('declaration insert returned no row');
        yield* projection.syncBorn(row, false);
      });
      yield* unit(
        declaring,
        Effect.gen(function* () {
          expect(yield* Effect.result(unit(declaring, declare.pipe(Effect.andThen(Effect.fail('cancelled')))))).toMatchObject({
            _tag: 'Failure',
            failure: 'cancelled',
          });
        }),
      );
      expect(yield* store.db.select().from(block).where(eq(block.id, 3))).toEqual([]);
      expect((yield* store.db.select().from(blockTag).where(eq(blockTag.tag, 'missing')))[0]?.typeId).toBeNull();
      yield* unit(writes('test.projection', [blockTag, blockField]), projection.syncTags(2));
      expect(
        yield* store.db
          .select({ tag: blockTag.tag, typeId: blockTag.typeId })
          .from(blockTag)
          .where(eq(blockTag.blockId, 2))
          .orderBy(blockTag.tag),
      ).toEqual(carried.toSorted().map((tag) => ({ tag, typeId: tag === 'note' || tag === permanent ? permanent : null })));
      yield* unit(declaring, declare);
      expect((yield* store.db.select().from(blockTag).where(eq(blockTag.tag, 'missing')))[0]?.typeId).toBe(
        'local:0198aaaa00007000800000000000c003',
      );
      yield* unit(
        declaring,
        Effect.gen(function* () {
          yield* store.db
            .update(block)
            .set({ fields: { id: permanent } })
            .where(eq(block.id, 3));
          yield* projection.syncTags(3);
        }),
      );
      expect((yield* store.db.select().from(blockTag).where(eq(blockTag.tag, permanent)))[0]?.typeId).toBeNull();
      expect((yield* store.db.select().from(block).where(eq(block.id, 2)))[0]?.tags).toEqual(carried);
    }),
  );
});
