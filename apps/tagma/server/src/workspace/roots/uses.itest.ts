import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Result, type Scope } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { meta } from '../../graph/store/tables.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer, storeLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { UseId } from '../contract/wire/ids.js';
import { type FileRoot, type RootBinding } from '../contract/wire/roots.js';
import type { RootUse, RootUseFailure, UseHolder, RootUseInput, RootUseSettlementInput } from '../contract/wire/uses.js';
import { type FileRootStore, makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from './registry.js';
import { FileRoots, RootReservations } from '../contract/service/roots.js';
import { makeRootUseStore } from '../store/uses.js';
import { type RootUseLedger, makeRootUseLedger } from './uses.js';

const provenance = { kind: 'adoption', id: 'operator' };
const namespaceId = NamespaceId.make('test-uses');
const left = { kind: 'terminal', id: 'left' };
const right = { kind: 'terminal', id: 'right' };
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const platform = Layer.mergeAll(
  BunFileSystem.layer,
  Path.layer,
  Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) }),
);
const layers = Layer.mergeAll(storage, platform);

const ledgerOver = (records: FileRootStore, roots: FileRoots['Service']) =>
  Effect.flatMap(MachineStore, ({ db }) =>
    Effect.provideService(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), FileRoots, roots),
  );

const owners = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* makeFileRootStore({ db });
  const roots = yield* makeRootRegistry({ store: records, namespaceId });
  return { db, units, files, paths, records, roots, uses: yield* ledgerOver(records, roots) };
});

const fixture = Effect.gen(function* () {
  const owned = yield* owners;
  return { ...owned, home: yield* owned.files.makeTempDirectoryScoped({ prefix: 'root-uses-' }) };
});

type Owned = { units: MachineUnits['Service']; uses: RootUseLedger };

const reserve = (owned: Owned, request: RootUseInput) => owned.units.write('RootUses.reserve', (unit) => owned.uses.reserve(unit, request));

const release = (owned: Owned, resolution: RootUseSettlementInput) =>
  owned.units.write('RootUses.release', (unit) => owned.uses.release(unit, resolution));

const forget = (owned: Owned, under: UseHolder | null, binding: RootBinding) =>
  owned.units.write('RootUses.forget', (unit) => owned.uses.forget(unit, under, binding));

const holder = (use: RootUse): UseHolder => ({ useId: use.useId, consumer: use.consumer });

const binding = (root: { rootId: RootBinding['rootId']; locationRevision: LocationRevision }): RootBinding => ({
  rootId: root.rootId,
  locationRevision: root.locationRevision,
});

const run = <A, E>(
  work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(work, layers);

it.live('a shared use reserves the roots its place stands in, a disruptive one every root it overlaps, and excludes the rest', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, home } = owned;
      const parent = paths.join(home, 'parent');
      const middle = paths.join(parent, 'middle');
      const child = paths.join(middle, 'child');
      const alias = paths.join(home, 'alias');
      const apart = paths.join(home, 'apart');
      yield* files.makeDirectory(child, { recursive: true });
      yield* files.makeDirectory(apart);
      yield* files.symlink(middle, alias);
      const outer = yield* roots.register({ path: parent, provenance });
      const equal = yield* roots.register({ path: middle, provenance });
      const inner = yield* roots.register({ path: child, provenance });
      const separate = yield* roots.register({ path: apart, provenance });
      const held = yield* reserve(owned, { footprint: yield* roots.resolveFootprint(alias), consumer: left, mode: 'shared' });
      const alongside = yield* reserve(owned, { footprint: yield* roots.resolveFootprint(child), consumer: right, mode: 'shared' });
      expect(held.resource.path).toBe(yield* files.realPath(middle));
      expect(new Set(held.roots.map(({ rootId }) => rootId))).toEqual(new Set([outer.rootId, equal.rootId]));
      expect(held.roots.every(({ locationRevision }) => locationRevision === 0)).toBe(true);
      expect(new Set(alongside.roots.map(({ rootId }) => rootId))).toEqual(new Set([outer.rootId, equal.rootId, inner.rootId]));
      const refused = yield* Effect.flip(
        reserve(owned, {
          footprint: yield* roots.resolveFootprint(parent),
          consumer: { kind: 'move', id: 'storage' },
          mode: 'disruptive',
        }),
      );
      expect(refused._tag).toBe('RootUseRefused');
      if (refused._tag === 'RootUseRefused') {
        expect(new Set(refused.uses.map((use) => use.useId))).toEqual(new Set([held.useId, alongside.useId]));
      }
      expect(yield* roots.read(outer.rootId, outer.locationRevision)).toEqual(outer);
      yield* release(owned, { useId: held.useId, consumer: left, outcome: 'completed' });
      yield* release(owned, { useId: alongside.useId, consumer: right, outcome: 'completed' });
      const moving = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(parent),
        consumer: { kind: 'move', id: 'storage' },
        mode: 'disruptive',
      });
      expect(new Set(moving.roots.map(({ rootId }) => rootId))).toEqual(new Set([outer.rootId, equal.rootId, inner.rootId]));
      yield* release(owned, { useId: moving.useId, consumer: { kind: 'move', id: 'storage' }, outcome: 'completed' });
      const elsewhere = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(apart),
        consumer: { kind: 'move', id: 'storage' },
        mode: 'disruptive',
      });
      expect(elsewhere.roots.map(({ rootId }) => rootId)).toEqual([separate.rootId]);
      const after = yield* Effect.flip(
        reserve(owned, {
          footprint: yield* roots.resolveFootprint(apart),
          consumer: left,
          mode: 'shared',
        }),
      );
      expect(after._tag).toBe('RootUseRefused');
      if (after._tag === 'RootUseRefused') expect(after.uses.map((use) => use.useId)).toEqual([elsewhere.useId]);
      const loose = paths.join(home, 'loose');
      yield* files.makeDirectory(loose);
      expect(
        (yield* reserve(owned, {
          footprint: yield* roots.resolveFootprint(loose),
          consumer: right,
          mode: 'disruptive',
        })).roots,
      ).toEqual([]);
    }),
  ),
);

it.live('command scopes follow unrelated retirement and relocation but refuse changed overlapping roots', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const target = paths.join(home, 'target');
      const outside = paths.join(home, 'outside');
      const elsewhere = paths.join(home, 'elsewhere');
      yield* files.makeDirectory(target);
      yield* files.makeDirectory(outside);
      yield* files.makeDirectory(elsewhere);
      const retired = yield* roots.register({ path: outside, provenance });
      const scope = roots.scope();
      const bound = roots.scope();
      expect((yield* scope.resolve(target)).roots).toEqual([]);
      yield* bound.resolve(outside);
      yield* forget(owned, null, retired);
      expect((yield* scope.resolve(target)).roots).toEqual([]);
      expect((yield* scope.resolve(outside)).roots).toEqual([]);
      expect((yield* Effect.flip(bound.resolve(outside)))._tag).toBe('RootMissing');
      const movable = yield* roots.register({ path: elsewhere, provenance });
      yield* scope.resolve(target);
      const moved = paths.join(target, 'moved');
      yield* files.rename(elsewhere, moved);
      const relocated = yield* uses.relocate(null, movable, moved);
      const refused = yield* Effect.flip(scope.resolve(target));
      expect(refused._tag).toBe('RootConflict');
      if (refused._tag === 'RootConflict') expect(refused.reason).toBe('resource-changed');
      expect((yield* roots.scope().resolve(target)).roots.map(({ root }) => root)).toEqual([relocated]);
    }),
  ),
);

it.live('a footprint of another namespace is refused, never checked here and kept as itself', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { units, files, paths, records, roots, home } = owned;
      const loose = paths.join(home, 'loose');
      yield* files.makeDirectory(loose);
      const other = yield* makeRootRegistry({ store: records, namespaceId: NamespaceId.make('other-uses') });
      const theirs = { units, uses: yield* ledgerOver(records, other) };
      const foreign = yield* other.resolveFootprint(loose);
      expect(foreign.roots).toEqual([]);
      expect(foreign.registryRevision).toBe(0);
      expect((yield* roots.resolveFootprint(loose)).registryRevision).toBe(0);
      const refused = yield* Effect.flip(reserve(owned, { footprint: foreign, consumer: left, mode: 'shared' }));
      expect(refused._tag).toBe('RootRefused');
      if (refused._tag === 'RootRefused') expect(refused.reason).toBe('foreign-namespace');
      yield* other.register({ path: loose, provenance });
      const moved = yield* Effect.flip(reserve(owned, { footprint: foreign, consumer: left, mode: 'shared' }));
      expect(moved._tag).toBe('RootRefused');
      if (moved._tag === 'RootRefused') expect(moved.reason).toBe('foreign-namespace');
      const use = yield* reserve(theirs, {
        footprint: yield* other.resolveFootprint(loose),
        consumer: left,
        mode: 'disruptive',
      });
      expect(use.resource.namespaceId).toBe(NamespaceId.make('other-uses'));
      const stranger = yield* Effect.flip(release(owned, { useId: use.useId, consumer: left, outcome: 'completed' }));
      expect(stranger._tag).toBe('RootUseMissing');
      expect((yield* release(theirs, { useId: use.useId, consumer: left, outcome: 'completed' })).state).toBe('released');
    }),
  ),
);

it.live('a held use refuses retirement, and the retirement it admits keeps the bytes', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const directory = paths.join(home, 'checkout');
      yield* files.makeDirectory(directory);
      yield* files.writeFileString(paths.join(directory, 'work'), 'unfinished work');
      const root = yield* roots.register({ path: directory, provenance });
      const use = yield* reserve(owned, { footprint: yield* roots.resolveFootprint(directory), consumer: left, mode: 'shared' });
      const busy = yield* Effect.flip(forget(owned, null, binding(root)));
      expect(busy._tag).toBe('RootUseRefused');
      if (busy._tag === 'RootUseRefused') expect(busy.uses.map((held) => held.useId)).toEqual([use.useId]);
      expect((yield* Effect.flip(forget(owned, holder(use), binding(root))))._tag).toBe('RootUseRefused');
      expect(yield* roots.read(root.rootId, root.locationRevision)).toEqual(root);
      expect((yield* release(owned, { useId: use.useId, consumer: left, outcome: 'completed' })).state).toBe('released');
      expect((yield* Effect.flip(forget(owned, holder(use), binding(root))))._tag).toBe('RootUseMissing');
      const retired = yield* forget(owned, null, binding(root));
      expect(retired.state).toBe('retired');
      expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootMissing');
      expect(yield* files.readFileString(paths.join(directory, 'work'))).toBe('unfinished work');
      const readopted = yield* roots.register({ path: directory, provenance });
      expect(readopted.rootId).not.toBe(root.rootId);
      expect((yield* roots.resolveFootprint(directory)).roots.map(({ root: covered }) => covered.rootId)).toEqual([readopted.rootId]);
    }),
  ),
);

it.live('a use whose consumer is gone is released as abandoned', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, home } = owned;
      const directory = paths.join(home, 'checkout');
      yield* files.makeDirectory(directory);
      const root = yield* roots.register({ path: directory, provenance });
      const use = yield* reserve(owned, { footprint: yield* roots.resolveFootprint(directory), consumer: left, mode: 'shared' });
      expect((yield* release(owned, { useId: use.useId, consumer: left, outcome: 'abandoned' })).state).toBe('released');
    }),
  ),
);

it.live('a footprint the registry has moved past cannot become a reservation', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const directory = paths.join(home, 'checkout');
      const other = paths.join(home, 'other');
      yield* files.makeDirectory(directory);
      yield* files.makeDirectory(other);
      const root = yield* roots.register({ path: directory, provenance });
      const footprint = yield* roots.resolveFootprint(directory);
      yield* roots.register({ path: other, provenance });
      const registered = yield* Effect.flip(reserve(owned, { footprint, consumer: left, mode: 'shared' }));
      expect(registered._tag).toBe('RootConflict');
      if (registered._tag === 'RootConflict') expect(registered.reason).toBe('registry-changed');
      yield* files.rename(directory, paths.join(home, 'moved'));
      const relocated = yield* uses.relocate(null, binding(root), paths.join(home, 'moved'));
      const stale = yield* Effect.flip(reserve(owned, { footprint, consumer: left, mode: 'shared' }));
      expect(stale._tag).toBe('RootConflict');
      if (stale._tag === 'RootConflict') expect(stale.reason).toBe('stale-binding');
      yield* forget(owned, null, binding(relocated));
      const gone = yield* Effect.flip(reserve(owned, { footprint, consumer: left, mode: 'shared' }));
      expect(gone._tag).toBe('RootMissing');
    }),
  ),
);

it.live('a reservation and a retirement of one root settle into a compatible order', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const settled = Effect.fnUntraced(function* (
        root: FileRoot,
        reserving: Result.Result<RootUse, RootUseFailure | StoreFailure>,
        forgotten: Result.Result<FileRoot, RootUseFailure | StoreFailure>,
      ) {
        if (reserving._tag === 'Success') {
          expect(forgotten._tag).toBe('Failure');
          if (forgotten._tag === 'Failure') {
            expect(forgotten.failure._tag).toBe('RootUseRefused');
            if (forgotten.failure._tag === 'RootUseRefused') {
              expect(forgotten.failure.uses.map((use) => use.useId)).toEqual([reserving.success.useId]);
            }
          }
          expect(yield* roots.read(root.rootId, root.locationRevision)).toEqual(root);
        } else {
          expect(forgotten._tag).toBe('Success');
          expect(reserving.failure._tag).toBe('RootMissing');
          expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootMissing');
        }
      });
      const race = Effect.fnUntraced(function* (name: string) {
        const directory = paths.join(home, name);
        yield* files.makeDirectory(directory);
        const root = yield* roots.register({ path: directory, provenance });
        const request: RootUseInput = {
          footprint: yield* roots.resolveFootprint(directory),
          consumer: left,
          mode: 'shared',
        };
        return { root, request };
      });
      const retiring = yield* race('retiring-first');
      const [forgotten, reserving] = yield* Effect.all(
        [Effect.result(forget(owned, null, binding(retiring.root))), Effect.result(reserve(owned, retiring.request))],
        { concurrency: 2 },
      );
      yield* settled(retiring.root, reserving, forgotten);
      const holding = yield* race('reserving-first');
      const [held, retired] = yield* Effect.all(
        [Effect.result(reserve(owned, holding.request)), Effect.result(forget(owned, null, binding(holding.root)))],
        { concurrency: 2 },
      );
      yield* settled(holding.root, held, retired);
    }),
  ),
);

it.live('a reservation taken while a location change reads the filesystem refuses it at the commit', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, records, roots, uses, home } = owned;
      const before = paths.join(home, 'before');
      const after = paths.join(home, 'after');
      yield* files.makeDirectory(before);
      const root = yield* roots.register({ path: before, provenance });
      const request: RootUseInput = {
        footprint: yield* roots.resolveFootprint(before),
        consumer: left,
        mode: 'shared',
      };
      yield* files.rename(before, after);
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const slowRoots = yield* Effect.provideService(makeRootRegistry({ store: records, namespaceId }), FileSystem.FileSystem, {
        ...files,
        stat: (path) =>
          path === after
            ? Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(resume);
                return yield* files.stat(path);
              })
            : files.stat(path),
      });
      const slow = yield* ledgerOver(records, slowRoots);
      const pending = yield* Effect.forkScoped(Effect.result(slow.relocate(null, binding(root), after)));
      yield* Deferred.await(entered);
      const use = yield* reserve(owned, request);
      yield* Deferred.succeed(resume, undefined);
      const refused = yield* Fiber.join(pending);
      expect(refused._tag).toBe('Failure');
      if (refused._tag === 'Failure') {
        expect(refused.failure._tag).toBe('RootUseRefused');
        if (refused.failure._tag === 'RootUseRefused') {
          expect(refused.failure.uses.map((held) => held.useId)).toEqual([use.useId]);
        }
      }
      yield* release(owned, { useId: use.useId, consumer: left, outcome: 'completed' });
      expect((yield* uses.relocate(null, binding(root), after)).locationRevision).toBe(LocationRevision.make(1));
    }),
  ),
);

it.live('a consumer intent and its reservation settle in one unit or in neither', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { db, units, files, paths, roots, uses, home } = owned;
      const directory = paths.join(home, 'checkout');
      yield* files.makeDirectory(directory);
      const root = yield* roots.register({ path: directory, provenance });
      const intent = (value: string) => db.insert(meta).values({ key: 'root-use-intent', value });
      const footprint = yield* roots.resolveFootprint(directory);
      const abandoned = yield* Effect.flip(
        units.write(
          'RootUses.abandoned',
          Effect.fnUntraced(function* (unit) {
            yield* unit.run(intent('launching'));
            yield* uses.reserve(unit, { footprint, consumer: left, mode: 'shared' });
            return yield* Effect.fail('the consumer could not be launched' as const);
          }),
        ),
      );
      expect(abandoned).toBe('the consumer could not be launched');
      expect(yield* db.select().from(meta).where(eq(meta.key, 'root-use-intent')).all()).toEqual([]);
      const alone = yield* reserve(owned, { footprint, consumer: left, mode: 'disruptive' });
      yield* release(owned, { useId: alone.useId, consumer: left, outcome: 'completed' });
      const use = yield* units.write(
        'RootUses.use',
        Effect.fnUntraced(function* (unit) {
          yield* unit.run(intent('running'));
          return yield* uses.reserve(unit, { footprint, consumer: left, mode: 'shared' });
        }),
      );
      expect((yield* db.select().from(meta).where(eq(meta.key, 'root-use-intent')).all()).map((row) => row.value)).toEqual(['running']);
      const busy = yield* Effect.flip(forget(owned, null, binding(root)));
      expect(busy._tag).toBe('RootUseRefused');
      if (busy._tag === 'RootUseRefused') expect(busy.uses.map((held) => held.useId)).toEqual([use.useId]);
    }),
  ),
);

it.live('an unresolved outcome keeps its protection across a reopen, and release is idempotent', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'root-uses-reopen-' });
    const directory = paths.join(home, 'checkout');
    yield* files.makeDirectory(directory);
    const layer = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(storeLayer(MachineStore, paths.join(home, 'uses.sqlite'), fixtureMigrations, {}, yield* sharedPool)),
    );
    const { root, use } = yield* Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* owners;
        const root = yield* owned.roots.register({ path: directory, provenance });
        const use = yield* reserve(owned, {
          footprint: yield* owned.roots.resolveFootprint(directory),
          consumer: left,
          mode: 'shared',
        });
        const uncertain = yield* Effect.flip(release(owned, { useId: use.useId, consumer: left, outcome: 'uncertain' }));
        expect(uncertain._tag).toBe('RootUseLost');
        return { root, use };
      }).pipe(Effect.provide(layer)),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* owners;
        const busy = yield* Effect.flip(forget(owned, null, binding(root)));
        expect(busy._tag).toBe('RootUseRefused');
        if (busy._tag === 'RootUseRefused') {
          expect(busy.uses.map((held) => held.useId)).toEqual([use.useId]);
          expect(busy.uses.flatMap((held) => held.roots.map(({ rootId }) => rootId))).toEqual([root.rootId]);
        }
        const missing = yield* Effect.flip(release(owned, { useId: UseId.make('unknown-use'), consumer: left, outcome: 'completed' }));
        expect(missing._tag).toBe('RootUseMissing');
        const foreign = yield* Effect.flip(release(owned, { useId: use.useId, consumer: right, outcome: 'completed' }));
        expect(foreign._tag).toBe('RootUseMissing');
        const released = yield* release(owned, { useId: use.useId, consumer: left, outcome: 'completed' });
        expect(released).toEqual({ ...use, state: 'released' });
        expect(yield* release(owned, { useId: use.useId, consumer: left, outcome: 'completed' })).toEqual(released);
        expect(yield* release(owned, { useId: use.useId, consumer: left, outcome: 'uncertain' })).toEqual(released);
        expect((yield* forget(owned, null, binding(root))).state).toBe('retired');
      }).pipe(Effect.provide(layer)),
    );
  }).pipe(Effect.provide(platform)),
);

it.live('a directory registered again under a fresh identity cannot escape a use still held over it', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'root-uses-identity-' });
    const directory = paths.join(home, 'checkout');
    const aside = paths.join(home, 'aside');
    const intruder = paths.join(home, 'intruder');
    yield* files.makeDirectory(directory);
    yield* files.writeFileString(paths.join(directory, 'work'), 'unfinished work');
    const layer = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(storeLayer(MachineStore, paths.join(home, 'uses.sqlite'), fixtureMigrations, {}, yield* sharedPool)),
    );
    const mover = { kind: 'move', id: 'storage' };
    const { use, readopted } = yield* Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* owners;
        const root = yield* owned.roots.register({ path: directory, provenance });
        const use = yield* reserve(owned, {
          footprint: yield* owned.roots.resolveFootprint(directory),
          consumer: mover,
          mode: 'disruptive',
        });
        yield* files.rename(directory, aside);
        yield* files.makeDirectory(directory);
        expect((yield* Effect.flip(owned.roots.read(root.rootId)))._tag).toBe('RootConflict');
        yield* files.rename(directory, intruder);
        yield* files.rename(aside, directory);
        const readopted = yield* owned.roots.register({ path: directory, provenance });
        expect(readopted.rootId).not.toBe(root.rootId);
        expect(readopted.witness).toEqual(root.witness);
        const busy = yield* Effect.flip(
          reserve(owned, {
            footprint: yield* owned.roots.resolveFootprint(directory),
            consumer: left,
            mode: 'shared',
          }),
        );
        expect(busy._tag).toBe('RootUseRefused');
        if (busy._tag === 'RootUseRefused') expect(busy.uses.map((held) => held.useId)).toEqual([use.useId]);
        return { use, readopted };
      }).pipe(Effect.provide(layer)),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const owned = yield* owners;
        const footprint = yield* owned.roots.resolveFootprint(directory);
        expect(footprint.roots.map(({ root }) => root.rootId)).toEqual([readopted.rootId]);
        expect((yield* Effect.flip(reserve(owned, { footprint, consumer: left, mode: 'shared' })))._tag).toBe('RootUseRefused');
        expect((yield* Effect.flip(forget(owned, null, binding(readopted))))._tag).toBe('RootUseRefused');
        const separate = yield* owned.roots.register({ path: intruder, provenance });
        expect(
          (yield* reserve(owned, {
            footprint: yield* owned.roots.resolveFootprint(intruder),
            consumer: left,
            mode: 'disruptive',
          })).roots.map(({ rootId }) => rootId),
        ).toEqual([separate.rootId]);
        expect((yield* forget(owned, holder(use), binding(readopted))).state).toBe('retired');
        yield* release(owned, { useId: use.useId, consumer: mover, outcome: 'completed' });
        const adopted = yield* owned.roots.register({ path: directory, provenance });
        expect(
          (yield* reserve(owned, {
            footprint: yield* owned.roots.resolveFootprint(directory),
            consumer: left,
            mode: 'shared',
          })).roots.map(({ rootId }) => rootId),
        ).toEqual([adopted.rootId]);
        expect(yield* files.readFileString(paths.join(directory, 'work'))).toBe('unfinished work');
      }).pipe(Effect.provide(layer)),
    );
  }).pipe(Effect.provide(platform)),
);
it.live('a location change follows the directory that moved and refuses one it does not own', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const before = paths.join(home, 'before');
      const after = paths.join(home, 'after');
      const elsewhere = paths.join(home, 'elsewhere');
      const parked = paths.join(home, 'parked');
      yield* files.makeDirectory(before);
      yield* files.makeDirectory(elsewhere);
      yield* files.makeDirectory(parked);
      yield* files.writeFileString(paths.join(before, 'work'), 'unfinished work');
      const root = yield* roots.register({ path: before, provenance });
      const occupant = yield* roots.register({ path: parked, provenance });
      yield* files.rename(before, after);
      const moved = yield* uses.relocate(null, binding(root), after);
      expect(moved.path).toBe(yield* files.realPath(after));
      expect(moved.locationRevision).toBe(LocationRevision.make(1));
      expect(yield* roots.read(root.rootId, LocationRevision.make(1))).toEqual(moved);
      const stale = yield* Effect.flip(roots.read(root.rootId, root.locationRevision));
      expect(stale._tag).toBe('RootConflict');
      if (stale._tag === 'RootConflict') expect(stale.reason).toBe('stale-binding');
      expect(yield* files.readFileString(paths.join(after, 'work'))).toBe('unfinished work');
      const use = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(after),
        consumer: left,
        mode: 'shared',
      });
      expect((yield* Effect.flip(uses.relocate(null, binding(moved), elsewhere)))._tag).toBe('RootUseRefused');
      yield* release(owned, { useId: use.useId, consumer: left, outcome: 'completed' });
      const foreign = yield* Effect.flip(uses.relocate(null, binding(moved), elsewhere));
      expect(foreign._tag).toBe('RootConflict');
      if (foreign._tag === 'RootConflict') expect(foreign.reason).toBe('binding-mismatch');
      const claim = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(parked),
        consumer: right,
        mode: 'shared',
      });
      yield* files.rename(parked, paths.join(home, 'parked-moved'));
      yield* files.rename(after, parked);
      const claimed = yield* Effect.flip(uses.relocate(null, binding(moved), parked));
      expect(claimed._tag).toBe('RootUseRefused');
      if (claimed._tag === 'RootUseRefused') expect(claimed.uses.map((held) => held.useId)).toEqual([claim.useId]);
      expect(yield* roots.checked(occupant.rootId, occupant.locationRevision)).toEqual(occupant);
      yield* release(owned, { useId: claim.useId, consumer: right, outcome: 'completed' });
      const taken = yield* uses.relocate(null, binding(moved), parked);
      expect(taken.path).toBe(yield* files.realPath(parked));
      expect(taken.locationRevision).toBe(LocationRevision.make(2));
      expect((yield* Effect.flip(roots.read(occupant.rootId)))._tag).toBe('RootConflict');
      expect((yield* roots.resolveFootprint(parked)).roots.map(({ root: covered }) => covered.rootId)).toEqual([root.rootId]);
    }),
  ),
);

it.live('a disruptive holder finishes the location change it reserved without releasing first', () =>
  run(
    Effect.gen(function* () {
      const owned = yield* fixture;
      const { files, paths, roots, uses, home } = owned;
      const before = paths.join(home, 'before');
      const after = paths.join(home, 'after');
      yield* files.makeDirectory(before);
      const root = yield* roots.register({ path: before, provenance });
      const mover = { kind: 'move', id: 'storage' };
      const use = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(before),
        consumer: mover,
        mode: 'disruptive',
      });
      expect(
        (yield* Effect.flip(
          reserve(owned, {
            footprint: yield* roots.resolveFootprint(before),
            consumer: left,
            mode: 'shared',
          }),
        ))._tag,
      ).toBe('RootUseRefused');
      yield* files.rename(before, after);
      const moved = yield* uses.relocate(holder(use), binding(root), after);
      expect(moved.locationRevision).toBe(LocationRevision.make(1));
      expect(
        (yield* Effect.flip(
          reserve(owned, {
            footprint: yield* roots.resolveFootprint(after),
            consumer: left,
            mode: 'shared',
          }),
        ))._tag,
      ).toBe('RootUseRefused');
      expect((yield* Effect.flip(forget(owned, { useId: use.useId, consumer: left }, binding(moved))))._tag).toBe('RootUseRefused');
      const apart = paths.join(home, 'apart');
      yield* files.makeDirectory(apart);
      const other = yield* roots.register({ path: apart, provenance });
      const held = yield* reserve(owned, {
        footprint: yield* roots.resolveFootprint(apart),
        consumer: mover,
        mode: 'disruptive',
      });
      expect((yield* Effect.flip(forget(owned, holder(held), binding(moved))))._tag).toBe('RootUseRefused');
      expect((yield* forget(owned, holder(use), binding(moved))).state).toBe('retired');
      yield* release(owned, { useId: use.useId, consumer: mover, outcome: 'completed' });
      yield* release(owned, { useId: held.useId, consumer: mover, outcome: 'completed' });
      expect(yield* roots.read(other.rootId, other.locationRevision)).toEqual(other);
    }),
  ),
);
