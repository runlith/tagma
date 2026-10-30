import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Clock, Deferred, Effect, Fiber, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { project } from '../../projects/store/table.js';
import { block } from '../store/tables.js';
import { blockName } from '../contract/wire/references.js';
import { blockNames } from './names.js';

const stores = unitsLayer(GraphUnits, GraphStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(GraphStore, fixtureGraphMigrations, { readers: 1 }, sharedPool))),
);

layer(stores, { excludeTestServices: true })('block names', (it) => {
  it.effect('names outside a write read committed identities while names inside it see that write', () =>
    Effect.gen(function* () {
      const store = yield* GraphStore;
      const units = yield* GraphUnits;
      const names = blockNames(store.db, units);
      const before = randomUUID();
      const after = randomUUID();
      const at = new Date(yield* Clock.currentTimeMillis);
      const [owner] = yield* store.db
        .insert(project)
        .values({
          name: 'names-reader',
          repoKey: 'names-reader',
          rootPath: '/names-reader',
          createdAt: at,
        })
        .returning({ id: project.id });
      expect(owner).toBeDefined();
      const [born] = yield* store.db
        .insert(block)
        .values({
          uuid: before,
          projectId: owner!.id,
          ord: 0,
          title: 'Identity',
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: block.id });
      expect(born).toBeDefined();
      const id = born!.id;

      const opened = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const writing = yield* Effect.forkScoped(
        units.write(writes('names.write', [block]), (unit) =>
          Effect.gen(function* () {
            yield* unit.run(store.db.update(block).set({ uuid: after }).where(eq(block.id, id)));
            expect(yield* names.nameOf(id)).toBe(blockName(after));
            expect(yield* names.idOfName(blockName(after))).toBe(id);
            yield* Deferred.succeed(opened, undefined);
            yield* Deferred.await(release);
          }),
        ),
      );
      yield* Deferred.await(opened);
      yield* Effect.gen(function* () {
        expect(yield* names.nameOf(id)).toBe(blockName(before));
        expect(yield* names.idOfName(blockName(before))).toBe(id);
        expect(yield* names.idsOfNames([blockName(before)])).toEqual(new Map([[blockName(before), id]]));
        expect(yield* names.namesOf([id])).toEqual(new Map([[id, blockName(before)]]));
        expect(yield* names.uuidOf(id)).toBe(before);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      yield* Fiber.join(writing);
      expect(yield* names.nameOf(id)).toBe(blockName(after));
      const collision = (after[0] === '0' ? '1' : '0') + after.slice(1);
      const [other] = yield* store.db
        .insert(block)
        .values({
          uuid: collision,
          projectId: owner!.id,
          ord: 1,
          title: 'Same short name',
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: block.id });
      expect(other).toBeDefined();
      const full = after.replaceAll('-', '');
      const second = collision.replaceAll('-', '');
      expect(yield* names.idsOfNames([blockName(after), full.toUpperCase(), second, full, 'invalid'])).toEqual(
        new Map([
          [full, id],
          [second, other!.id],
        ]),
      );
      expect(yield* Effect.flip(names.idOfName(blockName(after)))).toMatchObject({ code: 'ambiguous-name' });
    }),
  );
});
