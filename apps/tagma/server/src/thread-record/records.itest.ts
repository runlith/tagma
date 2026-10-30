import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { Clock, Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { bornThread } from '../native-harness/testing/born.js';
import { recordOf, scopeRecord } from './testing/records.js';
import { sessionFor } from '../external-harnesses/testing/sessions.js';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { project as projectRow } from '../projects/store/table.js';
import { ThreadRecords, type RecordAddress, type TitleRecorded } from './contract/service/records.js';
import { ThreadId } from '../platform/contract/wire/thread.js';
import { threadRecordsLayer } from './layer.js';

const base = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);
let store: MachineStore['Service'];
let units: MachineUnits['Service'];
let records: ThreadRecords['Service'];
let placed: number;

const birth = (id: string, parent: string | null, root: string) =>
  bornThread(store.db, {
    id,
    ownerId: 'owner',
    agentId: 'tagma',
    parentThreadId: parent,
    spawnRootId: root,
    cacheGroup: root,
    authority: THREAD_AUTHORITY_DEFAULT,
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
  });

const fixture = Layer.effectDiscard(
  Effect.gen(function* () {
    store = yield* MachineStore;
    units = yield* MachineUnits;
    records = yield* ThreadRecords;
    placed = yield* Effect.map(
      store.db
        .insert(projectRow)
        .values({ name: 'record', repoKey: 'record-key', rootPath: '/work', createdAt: new Date(yield* Clock.currentTimeMillis) })
        .returning({ id: projectRow.id }),
      (rows) => rows[0]?.id ?? 0,
    );
    yield* birth('root', null, 'root');
    yield* birth('child', 'root', 'root');
    yield* birth('grandchild', 'child', 'root');
    yield* birth('loose', null, 'loose');
    yield* scopeRecord(store.db, 'root', { projectId: placed, title: 'alpha' });
    yield* scopeRecord(store.db, 'child', { projectId: placed, title: 'beta' });
    yield* scopeRecord(store.db, 'grandchild', { projectId: placed, title: 'gamma' });
  }),
).pipe(Layer.provideMerge(threadRecordsLayer.pipe(Layer.provideMerge(base))));

const archivedAt = (id: string) => Effect.map(recordOf(store.db, id), (row) => row?.archivedAt ?? null);

layer(fixture)('records', (it) => {
  it.effect('facts read a scoped thread from its facet and a thread without one as unscoped with the default title', () =>
    Effect.gen(function* () {
      const scoped = yield* records.facts('child');
      expect(scoped).toMatchObject({
        id: 'child',
        projectId: placed,
        origin: 'scoped',
        parentId: 'root',
        spawnRootId: 'root',
        title: 'beta',
        titleProvenance: 'random',
        harness: 'tagma',
      });
      const loose = yield* records.facts('loose');
      expect(loose).toMatchObject({ projectId: null, origin: 'unscoped', title: 'New thread', titleRevision: 0 });
      expect(loose?.readerOrderAt).toEqual(new Date(1_000));
      expect(yield* records.facts('nowhere')).toBeUndefined();
    }),
  );

  it.effect('project reads count and name the facets of one project', () =>
    Effect.gen(function* () {
      const [project] = yield* store.db
        .insert(projectRow)
        .values({ name: 'counted', repoKey: 'counted-key', rootPath: '/counted', createdAt: new Date(yield* Clock.currentTimeMillis) })
        .returning({ id: projectRow.id });
      if (project === undefined) return yield* Effect.die(new Error('the counted project was not created'));
      yield* birth('counted-root', null, 'counted-root');
      yield* birth('counted-child', 'counted-root', 'counted-root');
      yield* birth('counted-grandchild', 'counted-child', 'counted-root');
      yield* scopeRecord(store.db, 'counted-root', { projectId: project.id, title: 'alpha' });
      yield* scopeRecord(store.db, 'counted-child', { projectId: project.id, title: 'beta' });
      yield* scopeRecord(store.db, 'counted-grandchild', { projectId: project.id, title: 'gamma' });
      expect(yield* records.projectOf('counted-grandchild')).toBe(project.id);
      expect(yield* records.projectOf('loose')).toBeUndefined();
      expect(yield* records.countIn(project.id)).toBe(3);
      expect(yield* units.read((unit) => records.namesIn(project.id, unit))).toEqual(new Set(['alpha', 'beta', 'gamma']));
    }),
  );

  it.effect('lineage is strict descent, and a subtree holds its root', () =>
    Effect.gen(function* () {
      expect(yield* records.isDescendant('grandchild', 'root')).toBe(true);
      expect(yield* records.isDescendant('root', 'root')).toBe(false);
      expect(yield* records.isDescendant('loose', 'root')).toBe(false);
      expect([...(yield* records.subtree('child'))].sort()).toEqual([ThreadId.make('child'), ThreadId.make('grandchild')]);
      expect(yield* records.subtree('root', undefined, 'child')).toEqual([ThreadId.make('grandchild')]);
      expect(yield* records.subtree('root', undefined, 'grandchild')).toEqual([]);
    }),
  );

  it.effect('unarchiving a family restores only the threads its own archive stamped', () =>
    Effect.gen(function* () {
      yield* units.write('test.archive', (unit) => records.setArchived(unit, ['grandchild'], new Date(5_000)));
      yield* units.write('test.archive', (unit) => records.setArchived(unit, ['root'], new Date(6_000)));
      expect(yield* archivedAt('child')).toEqual(new Date(6_000));
      expect(yield* archivedAt('grandchild')).toEqual(new Date(5_000));
      const restored = yield* units.write('test.unarchive', (unit) => records.setArchived(unit, ['root'], null));
      expect([...restored].sort()).toEqual([ThreadId.make('child'), ThreadId.make('root')]);
      expect(yield* archivedAt('grandchild')).toEqual(new Date(5_000));
      yield* units.write('test.unarchive', (unit) => records.setArchived(unit, ['grandchild'], null));
    }),
  );

  it.effect('a title write answers the revision compare and is recorded only once its unit commits', () =>
    Effect.gen(function* () {
      const seen: TitleRecorded[] = [];
      const stop = records.titleRecorded((event) => Effect.sync(() => void seen.push(event)));
      const failed = yield* Effect.exit(
        units.write('test.title', (unit) => Effect.andThen(records.nameTitle(unit, 'root', 'named', 0), Effect.fail('abandoned' as const))),
      );
      expect(failed._tag).toBe('Failure');
      expect(seen).toEqual([]);
      expect(yield* units.write('test.title', (unit) => records.nameTitle(unit, 'root', 'named', 1))).toMatchObject({
        outcome: 'superseded',
      });
      expect(yield* units.write('test.title', (unit) => records.nameTitle(unit, 'root', 'named', 0))).toMatchObject({
        outcome: 'written',
        after: { title: 'named', revision: 1 },
      });
      expect(yield* units.write('test.title', (unit) => records.nameTitle(unit, 'root', 'named', 1))).toMatchObject({
        outcome: 'same-text',
        before: { title: 'named', revision: 1 },
        after: { title: 'named', revision: 1 },
      });
      expect(seen).toEqual([{ threadId: ThreadId.make('root'), revision: 1 }]);
      expect(yield* records.facts('root')).toMatchObject({ title: 'named', titleProvenance: 'generated', titleRevision: 1 });
      stop();
    }),
  );

  it.effect('a project birth is recorded once after the whole transaction commits, and rollback records nothing', () =>
    Effect.gen(function* () {
      const id = ThreadId.make('01a00000-0000-7000-8000-00000000b017');
      yield* units.write('test.birth', (unit) =>
        records.insert(unit, {
          id,
          spawnRootId: id,
          principalId: 'operator',
          agentId: 'tagma',
        }),
      );
      const seen: RecordAddress[] = [];
      const titles: string[] = [];
      const stop = records.birthRecorded((event) =>
        Effect.gen(function* () {
          const facts = yield* records.facts(event.threadId).pipe(Effect.orDie);
          seen.push(event);
          titles.push(facts?.title ?? '');
        }),
      );
      const scope = { projectId: placed, title: 'at birth', titleOrigin: 'manual' as const };
      try {
        const abandoned = yield* Effect.exit(
          units.write('test.birth', (unit) => Effect.andThen(records.scope(unit, id, scope), Effect.fail('abandoned' as const))),
        );
        expect(abandoned._tag).toBe('Failure');
        expect(seen).toEqual([]);
        expect(yield* records.projectOf(id)).toBeUndefined();

        yield* units.write('test.birth', (unit) =>
          Effect.gen(function* () {
            expect(yield* records.scope(unit, id, scope)).toBe(true);
            expect(seen).toEqual([]);
            yield* records.setTitle(unit, id, 'committed title', 'manual');
          }),
        );
        expect(seen).toEqual([{ threadId: id, projectId: placed }]);
        expect(titles).toEqual(['committed title']);
        expect(yield* units.write('test.birth', (unit) => records.scope(unit, id, scope))).toBe(false);
        expect(seen).toEqual([{ threadId: id, projectId: placed }]);
      } finally {
        stop();
      }
    }),
  );

  it.effect('scoped insertion and removal publish their committed transitions, including rollback and repeated deletion', () =>
    Effect.gen(function* () {
      const id = ThreadId.make('01a00000-0000-7000-8000-00000000b018');
      const births: RecordAddress[] = [];
      const removals: RecordAddress[] = [];
      const stopBirths = records.birthRecorded((event) => Effect.sync(() => void births.push(event)));
      const stopRemovals = records.removalRecorded((event) => Effect.sync(() => void removals.push(event)));
      const birth = { id, projectId: placed, spawnRootId: id, principalId: 'operator', agentId: 'tagma' };
      try {
        expect(
          (yield* Effect.exit(units.write('test.insert', (unit) => Effect.andThen(records.insert(unit, birth), Effect.fail('rollback')))))
            ._tag,
        ).toBe('Failure');
        expect(yield* records.facts(id)).toBeUndefined();
        expect(births).toEqual([]);
        yield* units.write('test.insert', (unit) => records.insert(unit, birth));
        expect(births).toEqual([{ threadId: id, projectId: placed }]);

        expect(
          (yield* Effect.exit(units.write('test.remove', (unit) => Effect.andThen(records.remove(unit, [id]), Effect.fail('rollback')))))
            ._tag,
        ).toBe('Failure');
        expect(removals).toEqual([]);
        expect(yield* records.projectOf(id)).toBe(placed);
        yield* units.write('test.remove', (unit) =>
          Effect.gen(function* () {
            yield* records.remove(unit, [id]);
            expect(removals).toEqual([]);
          }),
        );
        expect(removals).toEqual([{ threadId: id, projectId: placed }]);
        expect(yield* records.facts(id)).toBeUndefined();
        yield* units.write('test.remove', (unit) => records.remove(unit, [id]));
        expect(removals).toEqual([{ threadId: id, projectId: placed }]);
      } finally {
        stopBirths();
        stopRemovals();
      }
    }),
  );

  it.effect('subscriber defects neither undo a committed birth nor block the other subscribers', () =>
    Effect.gen(function* () {
      const id = ThreadId.make('01a00000-0000-7000-8000-00000000b019');
      const seen: RecordAddress[] = [];
      const stopThrowing = records.birthRecorded(() => {
        throw new Error('subscriber construction failed');
      });
      const stopDying = records.birthRecorded(() => Effect.die(new Error('subscriber delivery failed')));
      const stopHealthy = records.birthRecorded((event) => Effect.sync(() => void seen.push(event)));
      try {
        const result = yield* Effect.exit(
          units.write('test.subscriber', (unit) =>
            records.insert(unit, {
              id,
              projectId: placed,
              spawnRootId: id,
              principalId: 'operator',
              agentId: 'tagma',
            }),
          ),
        );
        expect(result._tag).toBe('Success');
        expect(yield* records.projectOf(id)).toBe(placed);
        expect(seen).toEqual([{ threadId: id, projectId: placed }]);
      } finally {
        stopThrowing();
        stopDying();
        stopHealthy();
      }
    }),
  );

  it.effect('reader order advances only forward and writing restores an archived thread', () =>
    Effect.gen(function* () {
      yield* birth('ordered', null, 'ordered');
      yield* scopeRecord(store.db, 'ordered', { projectId: placed, title: 'ordered' });
      const advanced = new Date((yield* records.facts('ordered'))!.readerOrderAt.getTime() + 1_000);
      yield* units.write(records.writes, (unit) => records.advanceReaderOrder(unit, 'ordered', advanced));
      expect((yield* records.facts('ordered'))?.readerOrderAt).toEqual(advanced);
      expect((yield* records.facts('loose'))?.readerOrderAt).toEqual(new Date(1_000));
      yield* units.write(records.writes, (unit) => records.setArchived(unit, ['ordered'], new Date(3_000)));
      yield* units.write(records.writes, (unit) => records.advanceReaderOrder(unit, 'ordered', new Date(1_000)));
      expect(yield* records.facts('ordered')).toMatchObject({ readerOrderAt: advanced, archivedAt: null });
    }),
  );

  it.effect('touch moves the clock of an external thread and never of a native one', () =>
    Effect.gen(function* () {
      yield* birth('outside', null, 'outside');
      yield* scopeRecord(store.db, 'outside', { projectId: placed, title: 'delta' });
      yield* sessionFor(store.db, 'outside', JSON.parse('{"name":"claude-code"}') as Parameters<typeof sessionFor>[2]);
      yield* units.write('test.touch', (unit) => records.publishStatus(unit, 'outside', { movedAt: new Date(9_000) }));
      yield* units.write('test.touch', (unit) => records.publishStatus(unit, 'child', { movedAt: new Date(9_000) }));
      expect((yield* recordOf(store.db, 'outside'))?.movedAt).toEqual(new Date(9_000));
      expect((yield* recordOf(store.db, 'child'))?.movedAt).toBeNull();
    }),
  );
});
