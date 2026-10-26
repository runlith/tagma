import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { Effect, Layer } from 'effect';
import { bornThread } from '../native-harness/testing/born.js';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { ThreadId } from '../platform/contract/wire/thread.js';
import { ThreadRecords } from './contract/service/records.js';
import { threadRecordsLayer } from './layer.js';

const base = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations))),
);

layer(threadRecordsLayer.pipe(Layer.provideMerge(base)))('detachment', (it) => {
  it.effect(
    'a detached subtree preserves its lineage, refuses a blocked return and rejoins its parent with its pin before an archived child detaches',
    () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        const records = yield* ThreadRecords;
        const birth = (id: string, parent: string | null, root: string, name: string | null = null) =>
          bornThread(store.db, {
            id,
            ownerId: 'owner',
            agentId: 'tagma',
            parentThreadId: parent,
            spawnRootId: root,
            cacheGroup: root,
            name,
            authority: THREAD_AUTHORITY_DEFAULT,
          });
        const write = <A, E>(work: Parameters<typeof units.write<A, E>>[1]) => units.write(records.writes, work);
        const archive = (id: string, at: Date | null) => write((unit) => records.setArchived(unit, [id], at));
        yield* birth('x', null, 'x');
        yield* birth('y', 'x', 'x', 'y');
        yield* birth('z', 'y', 'x', 'z');
        yield* birth('sibling', 'x', 'x', 'sibling');

        const lifted = yield* write((unit) => records.detach(unit, 'y', new Date(5_000)));
        if (lifted.status !== 'detached') return yield* Effect.die(`detach answered ${lifted.status}`);
        expect(lifted.from).toBe(ThreadId.make('x'));
        expect(lifted.subtree.map(String).sort()).toEqual(['y', 'z']);
        expect(lifted.team.map(String).sort()).toEqual(['sibling', 'x']);
        expect(yield* records.facts('y')).toMatchObject({
          parentId: null,
          spawnRootId: 'y',
          detachedFrom: 'x',
          detachedAt: new Date(5_000),
        });
        expect(yield* records.facts('z')).toMatchObject({ parentId: 'y', spawnRootId: 'y' });
        expect(yield* records.facts('sibling')).toMatchObject({ parentId: 'x', spawnRootId: 'x' });
        expect(yield* write((unit) => records.detach(unit, 'y', new Date(6_000)))).toEqual({
          status: 'not-a-child',
          detachedFrom: ThreadId.make('x'),
          detachedAt: new Date(5_000),
        });

        yield* archive('x', new Date(7_000));
        expect(yield* write((unit) => records.reattach(unit, 'y'))).toEqual({ status: 'parent-archived', parent: ThreadId.make('x') });
        yield* archive('x', null);
        yield* birth('z-twin', 'x', 'x', 'z');
        expect(yield* write((unit) => records.reattach(unit, 'y'))).toEqual({
          status: 'name-taken',
          name: 'z',
          holder: ThreadId.make('z-twin'),
        });
        expect(yield* records.facts('y')).toMatchObject({ parentId: null, spawnRootId: 'y' });
        yield* write((unit) => records.remove(unit, ['z-twin']));
        yield* write((unit) => records.setPinned(unit, 'y', new Date(6_500)));

        const answer = yield* write((unit) => records.reattach(unit, 'y'));
        expect(answer).toMatchObject({ status: 'reattached', under: 'x', detachedAt: new Date(5_000) });
        expect(yield* records.facts('y')).toMatchObject({
          parentId: 'x',
          spawnRootId: 'x',
          detachedFrom: null,
          detachedAt: null,
          pinnedAt: new Date(6_500),
        });
        expect(yield* records.facts('z')).toMatchObject({ spawnRootId: 'x' });
        expect(yield* write((unit) => records.reattach(unit, 'y'))).toEqual({ status: 'not-detached' });

        yield* archive('z', new Date(8_000));
        expect(yield* write((unit) => records.detach(unit, 'z', new Date(9_000)))).toMatchObject({ status: 'detached', from: 'y' });
        expect(yield* records.facts('z')).toMatchObject({ parentId: null, spawnRootId: 'z', archivedAt: null });
      }),
  );
});
