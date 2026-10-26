import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Path, type Scope } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer, storeLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fileRootNamespace } from '../store/tables.js';
import { RootId } from '../contract/wire/ids.js';
import { RepositoryId } from '../contract/wire/repositories.js';
import { type FileRootStore, makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from './registry.js';
import { RootReservations } from '../contract/service/roots.js';

const unreserved = RootReservations.of({ holding: () => Effect.succeed(new Map()) });

const provenance = { kind: 'adoption', id: 'operator' };
const namespaceId = NamespaceId.make('test-files');
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, Layer.succeed(RootReservations, unreserved));

const over = (store: FileRootStore, files: FileSystem.FileSystem) =>
  Effect.provideService(makeRootRegistry({ store, namespaceId }), FileSystem.FileSystem, files);

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const { db } = yield* MachineStore;
  const records = yield* makeFileRootStore({ db });
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'file-roots-' });
  return { files, paths, records, home, roots: yield* makeRootRegistry({ store: records, namespaceId }) };
});

const run = <A, E>(
  work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(work, layers);

it.live('registration preserves bytes, deduplicates physical aliases and separates namespaces', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const directory = paths.join(home, 'checkout');
      const alias = paths.join(home, 'alias');
      yield* files.makeDirectory(directory);
      yield* files.writeFileString(paths.join(directory, 'work'), 'unfinished work');
      yield* files.symlink(directory, alias);
      const root = yield* roots.register({ path: directory, provenance });
      const duplicate = yield* roots.register({ path: alias, provenance: { kind: 'project', id: 'another-caller' } });
      const other = yield* makeRootRegistry({ store: records, namespaceId: NamespaceId.make('other-files') });
      const separate = yield* other.register({ path: directory, provenance });
      expect(duplicate).toEqual(root);
      expect(separate.rootId).not.toBe(root.rootId);
      expect(yield* files.readFileString(paths.join(directory, 'work'))).toBe('unfinished work');
      expect(yield* roots.read(root.rootId, root.locationRevision)).toEqual(root);
      expect((yield* Effect.flip(other.read(root.rootId)))._tag).toBe('RootMissing');
      expect((yield* Effect.flip(roots.read(root.rootId, LocationRevision.make(1))))._tag).toBe('RootConflict');
    }),
  ),
);

it.live('concurrent registrations converge on one identity', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const directory = paths.join(home, 'root');
      const alias = paths.join(home, 'alias');
      yield* files.makeDirectory(directory);
      yield* files.symlink(directory, alias);
      const registered = yield* Effect.all([roots.register({ path: directory, provenance }), roots.register({ path: alias, provenance })], {
        concurrency: 2,
      });
      const winner = yield* roots.register({ path: directory, provenance });
      expect(registered.map((root) => root.rootId)).toEqual([winner.rootId, winner.rootId]);
      expect((yield* roots.resolveFootprint(home)).roots.map(({ root }) => root.rootId)).toEqual([winner.rootId]);
    }),
  ),
);

it.live('unrelated registrations in one namespace both commit without a false conflict', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const left = paths.join(home, 'left');
      const right = paths.join(home, 'right');
      yield* files.makeDirectory(left);
      yield* files.makeDirectory(right);
      const registered = yield* Effect.all([roots.register({ path: left, provenance }), roots.register({ path: right, provenance })], {
        concurrency: 2,
      });
      expect(new Set((yield* roots.resolveFootprint(home)).roots.map(({ root }) => root.rootId))).toEqual(
        new Set(registered.map((root) => root.rootId)),
      );
    }),
  ),
);

it.live('reading one root accepts an unrelated registration during its filesystem check', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const directory = paths.join(home, 'root');
      const sibling = paths.join(home, 'sibling');
      yield* files.makeDirectory(directory);
      yield* files.makeDirectory(sibling);
      const root = yield* roots.register({ path: directory, provenance });
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const reader = yield* over(records, {
        ...files,
        realPath: (path) =>
          files.realPath(path).pipe(
            Effect.tap(() => Deferred.succeed(entered, undefined)),
            Effect.tap(() => Deferred.await(resume)),
          ),
      });
      const reading = yield* Effect.forkScoped(reader.read(root.rootId, root.locationRevision));
      yield* Deferred.await(entered);
      yield* roots.register({ path: sibling, provenance });
      yield* Deferred.succeed(resume, undefined);
      expect(yield* Fiber.join(reading)).toEqual(root);
    }),
  ),
);

it.live('reading a root refuses a registration retired while its directory check completes', () =>
  run(
    Effect.gen(function* () {
      const { files, records, home, roots } = yield* fixture;
      const root = yield* roots.register({ path: home, provenance });
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      let checks = 0;
      const reader = yield* over(records, {
        ...files,
        stat: (path) =>
          files.stat(path).pipe(
            Effect.tap(() => {
              checks += 1;
              return checks === 2 ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(resume))) : Effect.void;
            }),
          ),
      });
      const reading = yield* Effect.forkScoped(Effect.flip(reader.read(root.rootId)));
      yield* Deferred.await(entered);
      yield* records.write((unit) => records.retire(root, unit));
      yield* Deferred.succeed(resume, undefined);
      expect((yield* Fiber.join(reading))._tag).toBe('RootMissing');
    }),
  ),
);

it.live('registration re-resolves a checked candidate changed before its final Unit', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const directory = paths.join(home, 'root');
      yield* files.makeDirectory(directory);
      const root = yield* roots.register({ path: directory, provenance });
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const records = yield* Effect.provideService(makeFileRootStore({ db }), MachineUnits, {
        ...units,
        write: (operation, work) =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.andThen(units.write(operation, work))),
      });
      const contender = yield* makeRootRegistry({ store: records, namespaceId });
      const pending = yield* Effect.forkScoped(Effect.result(contender.register({ path: directory, provenance })));
      yield* Deferred.await(entered);
      yield* files.rename(directory, paths.join(home, 'original'));
      yield* files.makeDirectory(directory);
      expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootConflict');
      yield* Deferred.succeed(resume, undefined);
      const result = yield* Fiber.join(pending);
      expect(result._tag).toBe('Success');
      if (result._tag === 'Success') expect(result.success.rootId).not.toBe(root.rootId);
    }),
  ),
);

it.live('a footprint contains every ancestor and descendant through a real alias, not lexical siblings', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const parent = paths.join(home, 'root');
      const middle = paths.join(parent, 'middle');
      const child = paths.join(middle, 'child');
      const outside = paths.join(home, 'root-sibling');
      const alias = paths.join(home, 'alias');
      yield* files.makeDirectory(child, { recursive: true });
      yield* files.makeDirectory(outside);
      yield* files.symlink(middle, alias);
      const outer = yield* roots.register({ path: parent, provenance });
      const equal = yield* roots.register({ path: middle, provenance });
      const inner = yield* roots.register({ path: child, provenance });
      const footprint = yield* roots.resolveFootprint(alias);
      expect(footprint.status).toBe('complete');
      expect(footprint.resource.path).toBe(yield* files.realPath(middle));
      expect(new Map(footprint.roots.map(({ root, relation }) => [root.rootId, relation]))).toEqual(
        new Map([
          [outer.rootId, 'ancestor'],
          [equal.rootId, 'equal'],
          [inner.rootId, 'descendant'],
        ]),
      );
      expect((yield* roots.resolveFootprint(outside)).roots).toEqual([]);
      expect((yield* Effect.flip(roots.resolveFootprint(outside, equal)))._tag).toBe('RootConflict');
      expect(
        (yield* Effect.flip(
          roots.resolveFootprint(alias, {
            rootId: RootId.make('unknown-root'),
            locationRevision: LocationRevision.make(0),
          }),
        ))._tag,
      ).toBe('RootMissing');
    }),
  ),
);

it.live('a command scope resolves aliases and descendants but refuses registrations changed during the act', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const child = paths.join(home, 'child');
      const alias = paths.join(home, 'alias');
      yield* files.makeDirectory(child);
      yield* files.symlink(child, alias);
      const outer = yield* roots.register({ path: home, provenance });
      const inner = yield* roots.register({ path: child, provenance });
      const scope = roots.scope();
      expect((yield* scope.resolve(home)).roots.map(({ root }) => root.rootId)).toEqual([outer.rootId, inner.rootId]);
      const unrelated = yield* files.makeTempDirectoryScoped({ prefix: 'unrelated-root-' });
      yield* roots.register({ path: unrelated, provenance });
      expect((yield* scope.resolve(home)).roots.map(({ root }) => root.rootId)).toEqual([outer.rootId, inner.rootId]);
      const throughAlias = yield* scope.resolve(alias);
      expect(throughAlias.resource.path).toBe(yield* files.realPath(child));
      expect(throughAlias.roots.map(({ relation }) => relation)).toEqual(['ancestor', 'equal']);
      const added = paths.join(child, 'added');
      yield* files.makeDirectory(added);
      const nested = yield* roots.register({ path: added, provenance });
      const stale = yield* Effect.flip(scope.resolve(alias));
      expect(stale._tag).toBe('RootConflict');
      if (stale._tag === 'RootConflict') expect(stale.reason).toBe('resource-changed');
      expect((yield* roots.scope().resolve(child)).roots.map(({ root }) => root.rootId)).toEqual([
        outer.rootId,
        inner.rootId,
        nested.rootId,
      ]);
    }),
  ),
);

it.live('a retained footprint refuses a rebound root or resource before command acquisition', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const directory = paths.join(home, 'root');
      yield* files.makeDirectory(directory);
      const root = yield* roots.register({ path: directory, provenance });
      const footprint = yield* roots.scope().resolve(directory);
      yield* files.rename(directory, paths.join(home, 'away'));
      yield* files.makeDirectory(directory);
      const stale = yield* Effect.flip(roots.recheck(footprint));
      expect(stale._tag).toBe('RootConflict');
      if (stale._tag === 'RootConflict') expect(stale.reason).toBe('replaced');
      expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootConflict');
    }),
  ),
);

it.live('a rebound ancestor is resolved afresh even when the registered leaf identity is unchanged', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const before = paths.join(home, 'before');
      const after = paths.join(home, 'after');
      const leaf = paths.join(before, 'leaf');
      yield* files.makeDirectory(leaf, { recursive: true });
      yield* files.makeDirectory(after);
      const root = yield* roots.register({ path: leaf, provenance });
      const moved = paths.join(after, 'moved');
      yield* files.rename(before, moved);
      yield* files.symlink(moved, before);
      const footprint = yield* roots.resolveFootprint(after);
      expect(footprint.roots).toEqual([
        {
          root,
          resource: { namespaceId, path: yield* files.realPath(paths.join(moved, 'leaf')) },
          relation: 'descendant',
        },
      ]);
      const checked = yield* roots.read(root.rootId);
      expect(checked).toEqual(root);
      expect(yield* files.realPath(checked.path)).toBe(yield* files.realPath(paths.join(moved, 'leaf')));
      expect(yield* roots.register({ path: paths.join(moved, 'leaf'), provenance })).toEqual(root);
    }),
  ),
);

it.live('replacement is durable and re-adoption receives a new identity across store reopen', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'file-root-reopen-' });
    const directory = paths.join(home, 'checkout');
    const original = paths.join(home, 'original');
    yield* files.makeDirectory(directory);
    const layer = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(storeLayer(MachineStore, paths.join(home, 'roots.sqlite'), fixtureMigrations, {}, yield* sharedPool)),
    );
    const open = Effect.gen(function* () {
      const { db } = yield* MachineStore;
      return yield* makeRootRegistry({ store: yield* makeFileRootStore({ db }), namespaceId });
    });
    const { root, retained } = yield* Effect.scoped(
      Effect.gen(function* () {
        const roots = yield* open;
        const stable = paths.join(home, 'retained');
        yield* files.makeDirectory(stable);
        const retained = yield* roots.register({ path: stable, provenance });
        const registered = yield* roots.register({ path: directory, provenance });
        yield* files.rename(directory, original);
        yield* files.makeDirectory(directory);
        expect((yield* roots.resolveFootprint(directory)).roots).toEqual([]);
        return { root: registered, retained };
      }).pipe(Effect.provide(layer)),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const roots = yield* open;
        expect(yield* roots.read(retained.rootId)).toEqual(retained);
        expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootConflict');
        const replacement = yield* roots.register({ path: directory, provenance });
        expect(replacement.rootId).not.toBe(root.rootId);
        yield* files.rename(directory, paths.join(home, 'replacement'));
        yield* files.rename(original, directory);
        expect((yield* Effect.flip(roots.read(root.rootId)))._tag).toBe('RootConflict');
        const adopted = yield* roots.register({ path: directory, provenance });
        expect(adopted.rootId).not.toBe(root.rootId);
        expect(adopted.rootId).not.toBe(replacement.rootId);
        expect((yield* roots.resolveFootprint(directory)).roots.map(({ root }) => root.rootId)).toEqual([adopted.rootId]);
      }).pipe(Effect.provide(layer)),
    );
  }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, Path.layer, Layer.succeed(RootReservations, unreserved)))),
);

it.live('missing paths and failed filesystem resolution never become a successful empty footprint', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const file = paths.join(home, 'file');
      yield* files.writeFileString(file, 'retained bytes');
      const notDirectory = yield* Effect.flip(roots.register({ path: file, provenance }));
      expect(notDirectory._tag).toBe('RootInvalid');
      if (notDirectory._tag === 'RootInvalid') expect(notDirectory.reason).toBe('not-directory');
      const relative = yield* Effect.flip(roots.register({ path: 'relative', provenance }));
      expect(relative._tag).toBe('RootInvalid');
      if (relative._tag === 'RootInvalid') expect(relative.reason).toBe('relative-path');
      expect((yield* Effect.flip(roots.resolveFootprint('relative')))._tag).toBe('RootInvalid');
      const empty = yield* roots.resolveFootprint(home);
      expect(empty.roots).toEqual([]);
      expect(empty.registryRevision).toBe(0);
      const missing = paths.join(home, 'missing');
      expect((yield* Effect.flip(roots.resolveFootprint(missing)))._tag).toBe('RootMissing');
      const loop = paths.join(home, 'loop');
      yield* files.symlink('loop', loop);
      const unavailable = yield* Effect.flip(roots.resolveFootprint(loop));
      expect(unavailable._tag).toBe('RootUnavailable');
      if (unavailable._tag === 'RootUnavailable') expect(unavailable.reason).toBe('filesystem');
      const registered = paths.join(home, 'registered');
      yield* files.makeDirectory(registered);
      const away = yield* roots.register({ path: registered, provenance });
      yield* files.rename(registered, paths.join(home, 'moved'));
      expect((yield* roots.resolveFootprint(home)).roots.map(({ root }) => root.rootId)).not.toContain(away.rootId);
      expect((yield* Effect.flip(roots.read(away.rootId)))._tag).toBe('RootMissing');
    }),
  ),
);

it.live('a filesystem without a birthtime witness cannot adopt or condemn a root', () =>
  run(
    Effect.gen(function* () {
      const { files, records, home, roots } = yield* fixture;
      const root = yield* roots.register({ path: home, provenance });
      const reader = yield* over(records, {
        ...files,
        stat: (path) => Effect.map(files.stat(path), (info) => ({ ...info, birthtime: Option.some(new Date(0)) })),
      });
      for (const work of [reader.register({ path: home, provenance }), reader.read(root.rootId)]) {
        const failure = yield* Effect.flip(work);
        expect(failure._tag).toBe('RootUnavailable');
        if (failure._tag === 'RootUnavailable') expect(failure.reason).toBe('identity-unavailable');
      }
      expect((yield* Effect.flip(reader.resolveFootprint(home)))._tag).toBe('RootUnavailable');
      expect(yield* roots.read(root.rootId)).toEqual(root);
    }),
  ),
);

it.live('ancestor containment remains provable when only an ancestor lacks birthtime', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const root = yield* roots.register({ path: home, provenance });
      const ancestor = paths.parse(home).root;
      const reader = yield* over(records, {
        ...files,
        stat: (path) =>
          Effect.map(files.stat(path), (info) => (path === ancestor ? { ...info, birthtime: Option.some(new Date(0)) } : info)),
      });
      const footprint = yield* reader.resolveFootprint(home);
      expect(footprint.status).toBe('complete');
      expect(footprint.roots.map(({ root }) => root.rootId)).toEqual([root.rootId]);
    }),
  ),
);

it.live('an unreadable persisted registry revision cannot leave lookup as complete', () =>
  run(
    Effect.gen(function* () {
      const { home, roots } = yield* fixture;
      yield* roots.register({ path: home, provenance });
      const { db } = yield* MachineStore;
      yield* db.update(fileRootNamespace).set({ revision: -1 }).where(eq(fileRootNamespace.namespaceId, namespaceId));
      const failure = yield* Effect.flip(roots.resolveFootprint(home));
      expect(failure._tag).toBe('RootUnavailable');
      if (failure._tag === 'RootUnavailable') expect(failure.reason).toBe('storage');
    }),
  ),
);

const holding = (files: FileSystem.FileSystem, held: string, entered: Deferred.Deferred<void>, resume: Deferred.Deferred<void>) => ({
  ...files,
  stat: (path: string) =>
    path === held
      ? Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(resume);
          return yield* files.stat(path);
        })
      : files.stat(path),
});

it.live('filesystem lookup yields the database and takes in a registration landed during its IO', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const directory = paths.join(home, 'root');
      yield* files.makeDirectory(directory);
      yield* roots.register({ path: directory, provenance });
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const reader = yield* over(records, holding(files, yield* files.realPath(directory), entered, resume));
      const pending = yield* Effect.forkScoped(reader.resolveFootprint(home));
      yield* Deferred.await(entered);
      const added = yield* roots.register({ path: home, provenance });
      yield* Deferred.succeed(resume, undefined);
      expect((yield* Fiber.join(pending)).roots.map(({ root }) => root.rootId)).toContain(added.rootId);
    }),
  ),
);

it.live('a binding whose root relocates while the registry is read refuses as stale', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const held = paths.join(home, 'held');
      const before = paths.join(home, 'before');
      yield* files.makeDirectory(held);
      yield* files.makeDirectory(before);
      yield* roots.register({ path: held, provenance });
      const bound = yield* roots.register({ path: before, provenance });
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const reader = yield* over(records, holding(files, yield* files.realPath(held), entered, resume));
      const pending = yield* Effect.forkScoped(
        Effect.flip(reader.resolveFootprint(home, { rootId: bound.rootId, locationRevision: bound.locationRevision })),
      );
      yield* Deferred.await(entered);
      yield* files.rename(before, paths.join(home, 'after'));
      yield* roots.register({ path: paths.join(home, 'after'), provenance });
      yield* Deferred.succeed(resume, undefined);
      const refused = yield* Fiber.join(pending);
      expect(refused._tag).toBe('RootConflict');
      if (refused._tag === 'RootConflict') expect(refused.reason).toBe('stale-binding');
    }),
  ),
);

it.live('a fresh footprint refuses an alias retargeted while the registry is being read', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots } = yield* fixture;
      const first = paths.join(home, 'first');
      const second = paths.join(home, 'second');
      const registered = paths.join(home, 'registered');
      const alias = paths.join(home, 'alias');
      for (const directory of [first, second, registered]) yield* files.makeDirectory(directory);
      yield* files.symlink(first, alias);
      yield* roots.register({ path: registered, provenance });
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const reader = yield* over(records, holding(files, yield* files.realPath(registered), entered, resume));
      const pending = yield* Effect.forkScoped(Effect.result(reader.resolveFootprint(alias)));
      yield* Deferred.await(entered);
      yield* files.remove(alias);
      yield* files.symlink(second, alias);
      yield* Deferred.succeed(resume, undefined);
      const result = yield* Fiber.join(pending);
      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        expect(result.failure._tag).toBe('RootConflict');
        if (result.failure._tag === 'RootConflict') expect(result.failure.reason).toBe('resource-changed');
      }
    }),
  ),
);

it.live('a reserved place admits only the registration its holder waits for, and the reading still resolves', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, records, home, roots: open } = yield* fixture;
      const directory = paths.join(home, 'reserved');
      yield* files.makeDirectory(directory, { recursive: true });
      const units = yield* MachineUnits;
      const reserved = yield* files.realPath(directory);
      const admits = [
        { kind: 'worktree', id: '5' },
        { kind: 'worktree-recovered', id: '5' },
      ];
      const roots = yield* Effect.provideService(makeRootRegistry({ store: records, namespaceId }), RootReservations, {
        holding: (_namespace, paths) =>
          Effect.succeed(
            new Map(paths.filter((path) => path === reserved).map((path) => [path, [{ owner: 'worktree', holder: '5', admits }]])),
          ),
      });
      const adoption = yield* roots.resolve({ path: directory, provenance });
      const refused = yield* Effect.flip(units.write('FileRoots.refused', (unit) => roots.publish(adoption, unit)));
      expect(refused._tag).toBe('RootConflict');
      if (refused._tag === 'RootConflict') {
        expect(refused.reason).toBe('reserved');
        expect(refused.message).toContain('worktree 5');
      }
      expect((yield* open.resolveFootprint(directory)).roots).toEqual([]);
      const ordinary = yield* Effect.flip(roots.register({ path: directory, provenance }));
      expect(ordinary._tag).toBe('RootConflict');
      if (ordinary._tag === 'RootConflict') expect(ordinary.reason).toBe('reserved');
      expect((yield* open.resolveFootprint(directory)).roots).toEqual([]);
      const collision = yield* Effect.flip(roots.register({ path: directory, provenance: { kind: 'project', id: '5' } }));
      expect(collision._tag).toBe('RootConflict');
      if (collision._tag === 'RootConflict') expect(collision.reason).toBe('reserved');
      const waited = yield* roots.resolve({ path: directory, provenance: { kind: 'worktree', id: '5' } });
      const mine = yield* units.write('FileRoots.mine', (unit) => roots.publish(waited, unit));
      expect(mine.path).toBe(reserved);
      expect((yield* open.resolveFootprint(directory)).roots.map(({ root }) => root.rootId)).toEqual([mine.rootId]);
    }),
  ),
);

it.live('a registration whose directory is gone or holds a new occupant denies no other footprint, and can be retired', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const units = yield* MachineUnits;
      const gone = paths.join(home, 'removed');
      const standing = paths.join(home, 'kept');
      yield* files.makeDirectory(gone, { recursive: true });
      yield* files.makeDirectory(standing, { recursive: true });
      const dead = yield* roots.register({ path: gone, provenance });
      const live = yield* roots.register({ path: standing, provenance });
      yield* files.remove(gone, { recursive: true });
      const footprint = yield* roots.resolveFootprint(standing);
      expect(footprint.roots.map(({ root }) => root.rootId)).toEqual([live.rootId]);
      expect((yield* Effect.flip(roots.read(dead.rootId)))._tag).toBe('RootMissing');
      const swapped = paths.join(home, 'swapped');
      yield* files.makeDirectory(swapped, { recursive: true });
      yield* roots.register({ path: swapped, provenance });
      yield* files.remove(swapped, { recursive: true });
      yield* files.makeDirectory(swapped, { recursive: true });
      expect((yield* roots.recheck(footprint)).roots.map(({ root }) => root.rootId)).toEqual([live.rootId]);
      const healed = yield* roots.resolveFootprint(standing);
      expect(healed.roots.map(({ root }) => root.rootId)).toEqual([live.rootId]);
      const retired = yield* units.write('FileRoots.retired', (unit) => roots.retireMissing(dead.rootId, unit));
      expect(retired.state).toBe('retired');
      expect((yield* roots.resolveFootprint(standing)).roots.map(({ root }) => root.rootId)).toEqual([live.rootId]);
      const refused = yield* Effect.flip(units.write('FileRoots.refused', (unit) => roots.retireMissing(live.rootId, unit)));
      expect(refused._tag).toBe('RootConflict');
    }),
  ),
);

it.live('interrupting an in-flight capability read releases the lookup and leaves registration usable', () =>
  run(
    Effect.gen(function* () {
      const { files, records, home, roots } = yield* fixture;
      const entered = yield* Deferred.make<void>();
      const ended = yield* Deferred.make<void>();
      const reader = yield* over(records, {
        ...files,
        stat: Effect.fnUntraced(
          function* () {
            yield* Deferred.succeed(entered, undefined);
            return yield* Effect.never;
          },
          Effect.ensuring(Deferred.succeed(ended, undefined)),
        ),
      });
      const pending = yield* Effect.forkScoped(reader.resolveFootprint(home));
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(pending);
      yield* Deferred.await(ended);
      expect(Exit.hasInterrupts(yield* Fiber.await(pending))).toBe(true);
      const registered = yield* roots.register({ path: home, provenance });
      expect((yield* roots.resolveFootprint(home)).roots.map(({ root }) => root.rootId)).toEqual([registered.rootId]);
    }),
  ),
);

it.live('a checkout is removed once git no longer administers it; a vanished directory alone may have moved', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const repositoryId = RepositoryId.make('repository');
      const checkoutOf = Effect.fn(function* (name: string, administration: string) {
        const path = paths.join(home, name);
        yield* files.makeDirectory(path);
        yield* files.makeDirectory(administration, { recursive: true });
        const root = yield* roots.register({
          path,
          provenance,
          git: { repositoryId, gitDirectory: { namespaceId, path: yield* files.realPath(administration) } },
        });
        return { path, root };
      });
      const common = paths.join(home, 'repository', '.git');
      const pruned = yield* checkoutOf('pruned', paths.join(common, 'worktrees', 'pruned'));
      const moved = yield* checkoutOf('moved', paths.join(common, 'worktrees', 'moved'));
      const main = paths.join(home, 'main');
      const own = yield* checkoutOf('main', paths.join(main, '.git'));
      expect(yield* roots.removed(pruned.root.rootId)).toBe(false);
      yield* files.remove(pruned.path, { recursive: true });
      yield* files.remove(paths.join(common, 'worktrees', 'pruned'), { recursive: true });
      yield* files.remove(moved.path, { recursive: true });
      yield* files.remove(own.path, { recursive: true });
      expect(yield* roots.removed(pruned.root.rootId)).toBe(true);
      expect(yield* roots.removed(moved.root.rootId)).toBe(false);
      expect(yield* roots.removed(own.root.rootId)).toBe(false);
      expect(yield* roots.removed(RootId.make('never-registered'))).toBe(true);
    }),
  ),
);

it.live('registering the directory a root was moved to relocates that root under its own identity', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots } = yield* fixture;
      const before = paths.join(home, 'before');
      const after = paths.join(home, 'after');
      yield* files.makeDirectory(before);
      const root = yield* roots.register({ path: before, provenance });
      yield* files.rename(before, after);
      const moved = yield* roots.register({ path: after, provenance });
      expect(moved.rootId).toBe(root.rootId);
      expect(moved.locationRevision).toBe(LocationRevision.make(root.locationRevision + 1));
      expect((yield* roots.read(root.rootId)).path).toBe(yield* files.realPath(after));
    }),
  ),
);
