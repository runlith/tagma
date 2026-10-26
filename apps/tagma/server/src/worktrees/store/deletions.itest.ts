import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { DeletionUnreadable, makeDeletionIntents } from './deletions.js';

layer(
  Layer.orDie(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(
        Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
      ),
    ),
  ),
)('deletion intents', (it) => {
  it.effect(
    'an intent whose stored lists do not read is named, never thrown: byRoot fails typed and open lists it beside the readable ones',
    () =>
      Effect.gen(function* () {
        const readable = {
          key: RequestKey.make('deletion-a'),
          projectId: 1,
          rootId: 'root-a' as RootId,
          phase: 'committing' as const,
          paths: ['a.ts', 'b.ts'],
          holders: ['t-1'],
          at: new Date(1000),
        };
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        const intents = yield* makeDeletionIntents;
        yield* units.write('test.intend', (unit) => intents.intend(readable, unit));
        yield* store.db.run(
          sql`insert into worktree_deletion (key, project_id, root_id, phase, paths, holders, at) values ('deletion-b', 1, 'root-b', 'committing', '{"not":"a list"}', '[]', 2000)`,
        );

        const standing = yield* units.read((unit) => intents.byRoot('root-a' as RootId, unit));
        const refused = yield* Effect.flip(units.read((unit) => intents.byRoot('root-b' as RootId, unit)));
        const listed = yield* units.read((unit) => intents.open(null, 10, unit));

        expect(standing).toEqual(readable);
        expect(refused).toBeInstanceOf(DeletionUnreadable);
        expect(listed.map((row) => String(row.key))).toEqual(['deletion-a', 'deletion-b']);
        expect(listed[0]).toEqual(readable);
        expect(listed[1]).toBeInstanceOf(DeletionUnreadable);
      }),
  );
});
