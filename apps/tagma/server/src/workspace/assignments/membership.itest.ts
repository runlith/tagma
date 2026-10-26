import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer, Path, Result, type Scope } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { assignmentSelection } from '../store/tables.js';
import { project } from '../../projects/store/table.js';
import { MachineStore, type StoreDb, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureHome } from '../../platform/testing/roots.js';
import { threadParts, type ThreadParts } from '../../composition/testing/threadParts.js';
import { threadStore, type ThreadStore } from '../../native-harness/testing/doubles.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import {
  SelectionRevision,
  type Assignment,
  type AssignmentActor,
  type AssignmentBirth,
  type AssignmentFailure,
  type AssignmentInput,
  type AssignmentTarget,
  type Membership,
  type MembershipRelease,
} from '../contract/wire/assignments.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { RootId } from '../contract/wire/ids.js';
import type { FileRoot, RootBinding } from '../contract/wire/roots.js';
import { makeAssignmentStore } from '../store/assignments.js';
import { type AssignmentLedger, makeAssignmentLedger } from './membership.js';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from '../roots/registry.js';
import { FileRoots, RootReservations } from '../contract/service/roots.js';
import { ThreadLineage } from '../contract/service/assignments.js';
import { makeRootUseStore } from '../store/uses.js';
import { type RootUseLedger, makeRootUseLedger } from '../roots/uses.js';
import { lineageOver } from '../testing/lineage.js';
import { ENTRY_KINDS } from '../../composition/manifest.js';

const provenance = { kind: 'adoption', id: 'operator' };
const namespaceId = NamespaceId.make('test-assignments');
const operator = { kind: 'operator' } as const satisfies AssignmentActor;
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const reservations = Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) });
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, reservations);

const owners = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const records = yield* makeFileRootStore({ db });
  const roots = yield* makeRootRegistry({ store: records, namespaceId });
  const threadRecords = yield* makeThreadRecords;
  const kernel = yield* threadStore(threadRecords, ENTRY_KINDS);
  const threads = yield* threadParts({ db, units, threads: kernel, records: threadRecords });
  const uses = yield* Effect.provideService(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), FileRoots, roots);
  const assignments = yield* makeAssignmentLedger({ store: makeAssignmentStore({ db }) }).pipe(
    Effect.provideService(FileRoots, roots),
    Effect.provideService(ThreadLineage, yield* lineageOver(store, units)),
  );
  return { db, units, files, paths, roots, kernel, threads, uses, assignments };
});

const fixture = Effect.gen(function* () {
  const owned = yield* owners;
  const home = yield* owned.files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'assignments-' });
  return { ...owned, home };
});

type Owned = { units: MachineUnits['Service']; assignments: AssignmentLedger };

type Born = { units: MachineUnits['Service']; kernel: ThreadStore; threads: ThreadParts };

type Placed = { files: FileSystem.FileSystem; paths: Path.Path; home: string };

type RootHeld = { readonly _tag: 'RootHeld'; readonly holders: readonly Membership[] };

const rootHeld = (failure: unknown): failure is RootHeld =>
  typeof failure === 'object' && failure !== null && '_tag' in failure && failure._tag === 'RootHeld';

const read = (owned: Owned, threadId: ThreadId) => owned.units.read((unit) => owned.assignments.read(unit, threadId));

const enroll = (owned: Owned, request: AssignmentInput) =>
  owned.units.write('Assignments.enroll', (unit) => owned.assignments.enroll(unit, request));

const withdraw = (owned: Owned, release: MembershipRelease) =>
  owned.units.write('Assignments.withdraw', (unit) => owned.assignments.withdraw(unit, release));

const select = (owned: Owned, request: AssignmentInput) =>
  owned.units.write('Assignments.select', (unit) => owned.assignments.select(unit, request));

const clear = (owned: Owned, target: AssignmentTarget) =>
  owned.units.write('Assignments.clear', (unit) => owned.assignments.clear(unit, target));

const inherit = (owned: Owned, birth: AssignmentBirth) =>
  owned.units.write('Assignments.inherit', (unit) => owned.assignments.inherit(unit, birth));

const publish = (owned: Owned, threadId: ThreadId, revision: number) =>
  owned.units.read((unit) => owned.assignments.publish(unit, threadId, SelectionRevision.make(revision)));

const holdersOf = (owned: Owned, rootId: RootId) => owned.units.read((unit) => owned.assignments.holdersOf(unit, [rootId]));

const forget = (owned: Owned & { uses: RootUseLedger }, binding: RootBinding) =>
  owned.units.write(
    'Assignments.forget',
    Effect.fnUntraced(function* (unit) {
      const holders = yield* owned.assignments.holdersOf(unit, [binding.rootId]);
      if (holders.length > 0) return yield* Effect.fail<RootHeld>({ _tag: 'RootHeld', holders });
      return yield* owned.uses.forget(unit, null, binding);
    }),
  );

const binding = (root: FileRoot): RootBinding => ({ rootId: root.rootId, locationRevision: root.locationRevision });

const acting = (threadId: ThreadId): AssignmentActor => ({ kind: 'thread', threadId });

const rootsOf = (memberships: readonly Membership[]) => new Set(memberships.map((held) => held.rootId));

const directory = (owned: Placed, name: string): Effect.Effect<string, never> =>
  Effect.map(Effect.orDie(owned.files.makeDirectory(owned.paths.join(owned.home, name), { recursive: true })), () =>
    owned.paths.join(owned.home, name),
  );

const registerProject = (owned: { db: StoreDb<'machine'> }, name: string): Effect.Effect<number, StoreFailure> =>
  Effect.flatMap(
    owned.db
      .insert(project)
      .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt: new Date() })
      .returning({ id: project.id })
      .get(),
    (row) => (row === undefined ? Effect.die(new Error('the test project was not registered')) : Effect.succeed(row.id)),
  );

const born = (owned: Born, projectId: number, parent?: ThreadId) =>
  owned.units.write(
    'Assignments.born',
    Effect.fnUntraced(function* (unit) {
      if (parent === undefined) {
        const row = yield* owned.kernel.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* owned.threads.rows.attachFacet({ threadId: row.id, projectId }, unit);
        return ThreadId.make(row.id);
      }
      const row = yield* owned.kernel.insertChild(parent, { ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* owned.threads.rows.inheritFacet({ threadId: row.id, fromThreadId: parent, agentId: 'tagma', projectId }, unit);
      return ThreadId.make(row.id);
    }),
  );

const run = <A, E>(
  work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(work, layers);

it.live('a root holds many threads, a thread stands in many roots, and exactly one of them is selected', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, roots } = owned;
      const projectId = yield* registerProject(owned, 'shared');
      const first = yield* born(owned, projectId);
      const second = yield* born(owned, projectId);
      const shared = yield* roots.register({ path: yield* directory(owned, 'shared'), provenance });
      const beside = yield* roots.register({ path: yield* directory(owned, 'beside'), provenance });
      const apart = yield* roots.register({ path: yield* directory(owned, 'apart'), provenance });
      yield* select(owned, { actor: operator, threadId: first, root: binding(shared) });
      yield* select(owned, { actor: operator, threadId: second, root: binding(shared) });
      expect(new Set((yield* holdersOf(owned, shared.rootId)).map((held) => held.threadId))).toEqual(new Set([first, second]));
      yield* enroll(owned, { actor: operator, threadId: first, root: binding(beside) });
      yield* enroll(owned, { actor: operator, threadId: first, root: binding(apart) });
      const grouped = yield* read(owned, first);
      expect(rootsOf(grouped.memberships)).toEqual(new Set([shared.rootId, beside.rootId, apart.rootId]));
      expect(grouped.selection).toEqual({ rootId: shared.rootId, provenance: 'explicit', revision: SelectionRevision.make(1) });
      const moved = yield* select(owned, { actor: operator, threadId: first, root: binding(beside) });
      expect(moved.selection).toEqual({ rootId: beside.rootId, provenance: 'explicit', revision: SelectionRevision.make(2) });
      expect(rootsOf(moved.memberships)).toEqual(new Set([shared.rootId, beside.rootId, apart.rootId]));
      expect((yield* read(owned, second)).selection.rootId).toBe(shared.rootId);
      const held = yield* Effect.flip(withdraw(owned, { actor: operator, threadId: first, rootId: beside.rootId }));
      expect(held._tag).toBe('AssignmentRefused');
      if (held._tag === 'AssignmentRefused') expect(held.reason).toBe('selected');
      const left = yield* withdraw(owned, { actor: operator, threadId: first, rootId: apart.rootId });
      expect(rootsOf(left.memberships)).toEqual(new Set([shared.rootId, beside.rootId]));
      expect(yield* roots.read(apart.rootId, apart.locationRevision)).toEqual(apart);
      expect(yield* files.exists(apart.path)).toBe(true);
      const stranger = yield* Effect.flip(withdraw(owned, { actor: operator, threadId: second, rootId: apart.rootId }));
      expect(stranger._tag).toBe('AssignmentRefused');
      if (stranger._tag === 'AssignmentRefused') expect(stranger.reason).toBe('not-a-member');
    }),
  ),
);

it.live('a child inherits the root its parent captured, and its selection moves alone', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { roots } = owned;
      const projectId = yield* registerProject(owned, 'lineage');
      const parent = yield* born(owned, projectId);
      const captured = yield* roots.register({ path: yield* directory(owned, 'captured'), provenance });
      const elsewhere = yield* roots.register({ path: yield* directory(owned, 'elsewhere'), provenance });
      yield* select(owned, { actor: operator, threadId: parent, root: binding(captured) });
      const child = yield* born(owned, projectId, parent);
      const sibling = yield* born(owned, projectId, parent);
      for (const newborn of [child, sibling]) {
        const carried = yield* inherit(owned, { threadId: newborn, parentThreadId: parent });
        expect(carried.selection).toEqual({ rootId: captured.rootId, provenance: 'inherited', revision: SelectionRevision.make(1) });
        expect(rootsOf(carried.memberships)).toEqual(new Set([captured.rootId]));
      }
      expect((yield* holdersOf(owned, captured.rootId)).map((held) => held.provenance).sort()).toEqual([
        'explicit',
        'inherited',
        'inherited',
      ]);
      const moved = yield* select(owned, { actor: acting(parent), threadId: child, root: binding(elsewhere) });
      expect(moved.selection).toEqual({ rootId: elsewhere.rootId, provenance: 'explicit', revision: SelectionRevision.make(2) });
      expect(rootsOf(moved.memberships)).toEqual(new Set([captured.rootId, elsewhere.rootId]));
      expect((yield* read(owned, parent)).selection.rootId).toBe(captured.rootId);
      expect((yield* read(owned, sibling)).selection).toEqual({
        rootId: captured.rootId,
        provenance: 'inherited',
        revision: SelectionRevision.make(1),
      });
      const otherProject = yield* registerProject(owned, 'lineage-elsewhere');
      const named = yield* born(owned, otherProject, parent);
      expect((yield* inherit(owned, { threadId: named, parentThreadId: parent, root: binding(elsewhere) })).selection).toEqual({
        rootId: elsewhere.rootId,
        provenance: 'explicit',
        revision: SelectionRevision.make(1),
      });
      const quiet = yield* born(owned, projectId);
      const untouched = yield* born(owned, projectId, quiet);
      expect(yield* inherit(owned, { threadId: untouched, parentThreadId: quiet })).toEqual({
        threadId: untouched,
        memberships: [],
        selection: { rootId: null, provenance: 'intrinsic', revision: SelectionRevision.make(0) },
        standing: 'none',
      });
      const emptied = yield* born(owned, projectId);
      yield* select(owned, { actor: operator, threadId: emptied, root: binding(captured) });
      yield* clear(owned, { actor: operator, threadId: emptied });
      const bornEmpty = yield* born(owned, projectId, emptied);
      expect(yield* inherit(owned, { threadId: bornEmpty, parentThreadId: emptied })).toEqual({
        threadId: bornEmpty,
        memberships: [],
        selection: { rootId: null, provenance: 'inherited', revision: SelectionRevision.make(1) },
        standing: 'none',
      });
      const outside = yield* born(owned, projectId);
      const unrelated = yield* Effect.flip(inherit(owned, { threadId: outside, parentThreadId: parent }));
      expect(unrelated._tag).toBe('AssignmentRefused');
      if (unrelated._tag === 'AssignmentRefused') expect(unrelated.reason).toBe('out-of-reach');
      const nobody = ThreadId.make('no-such-parent');
      const missing = yield* Effect.flip(inherit(owned, { threadId: outside, parentThreadId: nobody }));
      expect(missing._tag).toBe('AssignmentRefused');
      if (missing._tag === 'AssignmentRefused') {
        expect(missing.reason).toBe('unknown-thread');
        expect(missing.threadId).toBe(nobody);
      }
      const foreign = yield* born(owned, otherProject);
      const crossed = yield* Effect.flip(
        inherit(owned, {
          threadId: outside,
          parentThreadId: foreign,
          root: binding(elsewhere),
        }),
      );
      expect(crossed._tag).toBe('AssignmentRefused');
      if (crossed._tag === 'AssignmentRefused') expect(crossed.reason).toBe('out-of-reach');
      expect((yield* read(owned, outside)).selection.provenance).toBe('intrinsic');
    }),
  ),
);

it.live('an intrinsic assignment is derived, a cleared one is written, and a publication measures the revision', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { db, roots } = owned;
      const projectId = yield* registerProject(owned, 'intrinsic');
      const threadId = yield* born(owned, projectId);
      const root = yield* roots.register({ path: yield* directory(owned, 'checkout'), provenance });
      expect(yield* read(owned, threadId)).toEqual({
        threadId,
        memberships: [],
        selection: { rootId: null, provenance: 'intrinsic', revision: SelectionRevision.make(0) },
        standing: 'none',
      });
      expect(yield* db.select().from(assignmentSelection).where(eq(assignmentSelection.threadId, threadId)).all()).toEqual([]);
      expect((yield* publish(owned, threadId, 0)).current).toBe(true);
      yield* select(owned, { actor: operator, threadId, root: binding(root) });
      const overtaken = yield* publish(owned, threadId, 0);
      expect(overtaken.current).toBe(false);
      expect(overtaken.selection).toEqual({ rootId: root.rootId, provenance: 'explicit', revision: SelectionRevision.make(1) });
      expect((yield* publish(owned, threadId, 1)).current).toBe(true);
      const cleared = yield* clear(owned, { actor: operator, threadId });
      expect(cleared.selection).toEqual({ rootId: null, provenance: 'cleared', revision: SelectionRevision.make(2) });
      expect(rootsOf(cleared.memberships)).toEqual(new Set([root.rootId]));
      expect((yield* publish(owned, threadId, 1)).current).toBe(false);
      expect((yield* publish(owned, threadId, 2)).current).toBe(true);
      expect((yield* holdersOf(owned, root.rootId)).map((held) => held.threadId)).toEqual([threadId]);
      const unknown = ThreadId.make('no-such-thread');
      const answers = [
        yield* Effect.flip(read(owned, unknown)),
        yield* Effect.flip(publish(owned, unknown, 0)),
        yield* Effect.flip(clear(owned, { actor: operator, threadId: unknown })),
      ];
      for (const answered of answers) {
        expect(answered._tag).toBe('AssignmentRefused');
        if (answered._tag === 'AssignmentRefused') expect(answered.reason).toBe('unknown-thread');
      }
    }),
  ),
);

it.live('an actor places itself and its descendants across homes, while unrelated threads remain out of reach', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { roots } = owned;
      const here = yield* registerProject(owned, 'here');
      const there = yield* registerProject(owned, 'there');
      const actor = yield* born(owned, here);
      const child = yield* born(owned, there, actor);
      const grandchild = yield* born(owned, here, child);
      const stranger = yield* born(owned, here);
      const foreign = yield* born(owned, there);
      const root = yield* roots.register({ path: yield* directory(owned, 'checkout'), provenance });
      const request = (threadId: ThreadId): AssignmentInput => ({ actor: acting(actor), threadId, root: binding(root) });
      expect((yield* select(owned, request(actor))).selection.rootId).toBe(root.rootId);
      expect((yield* select(owned, request(child))).selection.rootId).toBe(root.rootId);
      expect((yield* select(owned, request(grandchild))).selection.rootId).toBe(root.rootId);
      const refused = yield* Effect.flip(select(owned, request(stranger)));
      expect(refused._tag).toBe('AssignmentRefused');
      if (refused._tag === 'AssignmentRefused') expect(refused.reason).toBe('out-of-reach');
      expect((yield* read(owned, stranger)).selection.provenance).toBe('intrinsic');
      const crossed = yield* Effect.flip(select(owned, request(foreign)));
      expect(crossed._tag).toBe('AssignmentRefused');
      if (crossed._tag === 'AssignmentRefused') expect(crossed.reason).toBe('out-of-reach');
      expect((yield* select(owned, { actor: operator, threadId: foreign, root: binding(root) })).selection.rootId).toBe(root.rootId);
    }),
  ),
);

it.live('an assignment and the retirement of the root it names settle into a compatible order', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const projectId = yield* registerProject(owned, 'races');
      const threadId = yield* born(owned, projectId);
      const parent = yield* born(owned, projectId);
      const newborn = yield* born(owned, projectId, parent);
      const settled = Effect.fnUntraced(function* (
        root: FileRoot,
        assigning: Result.Result<Assignment, AssignmentFailure | StoreFailure>,
        forgotten: Result.Result<unknown, unknown>,
      ) {
        if (assigning._tag === 'Success') {
          expect(assigning.success.selection.rootId).toBe(root.rootId);
          expect(rootsOf(assigning.success.memberships)).toContain(root.rootId);
          expect(forgotten._tag).toBe('Failure');
          expect(forgotten._tag === 'Failure' && rootHeld(forgotten.failure)).toBe(true);
          if (forgotten._tag === 'Failure' && rootHeld(forgotten.failure)) {
            expect(forgotten.failure.holders.map((held) => held.rootId)).toEqual([root.rootId]);
          }
          expect(yield* roots.read(root.rootId, root.locationRevision)).toEqual(root);
        } else {
          expect(forgotten._tag).toBe('Success');
          expect(assigning.failure._tag).toBe('RootMissing');
          expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootMissing');
        }
      });
      const contest = Effect.fnUntraced(function* (
        name: string,
        assign: (root: FileRoot) => Effect.Effect<Assignment, AssignmentFailure | StoreFailure>,
      ) {
        const first = yield* roots.register({ path: yield* directory(owned, name), provenance });
        const [assigned, refused] = yield* Effect.all([Effect.result(assign(first)), Effect.result(forget(owned, binding(first)))], {
          concurrency: 2,
        });
        yield* settled(first, assigned, refused);
        const second = yield* roots.register({ path: yield* directory(owned, `${name}-reversed`), provenance });
        const [retired, taken] = yield* Effect.all([Effect.result(forget(owned, binding(second))), Effect.result(assign(second))], {
          concurrency: 2,
        });
        yield* settled(second, taken, retired);
      });
      yield* contest('assigned', (root) => select(owned, { actor: operator, threadId, root: binding(root) }));
      yield* contest('born', (root) => inherit(owned, { threadId: newborn, parentThreadId: parent, root: binding(root) }));
      const moving = yield* roots.register({ path: yield* directory(owned, 'moving'), provenance });
      const after = paths.join(home, 'moved-to');
      yield* files.rename(moving.path, after);
      const relocated = yield* uses.relocate(null, binding(moving), after);
      const stale = yield* Effect.flip(enroll(owned, { actor: operator, threadId, root: binding(moving) }));
      expect(stale._tag).toBe('RootConflict');
      if (stale._tag === 'RootConflict') expect(stale.reason).toBe('stale-binding');
      expect(rootsOf((yield* enroll(owned, { actor: operator, threadId, root: binding(relocated) })).memberships)).toContain(
        relocated.rootId,
      );
      const outlived = yield* roots.register({ path: yield* directory(owned, 'outlived'), provenance });
      const chosen = yield* born(owned, projectId);
      expect((yield* select(owned, { actor: operator, threadId: chosen, root: binding(outlived) })).standing).toBe('live');
      expect(yield* publish(owned, chosen, 1)).toMatchObject({ current: true, standing: 'live' });
      yield* files.rename(outlived.path, paths.join(home, 'outlived-moved'));
      yield* files.makeDirectory(outlived.path);
      expect((yield* Effect.flip(roots.read(outlived.rootId)))._tag).toBe('RootConflict');
      const outstanding = yield* read(owned, chosen);
      expect(outstanding.selection.rootId).toBe(outlived.rootId);
      expect(outstanding.standing).toBe('gone');
      expect(yield* publish(owned, chosen, 1)).toMatchObject({ current: true, standing: 'gone' });
      expect(yield* publish(owned, chosen, 0)).toMatchObject({ current: false, standing: 'gone' });
    }),
  ),
);
