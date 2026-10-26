import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer, Path, type Scope } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from './registry.js';
import { makeRootHealing } from './healing.js';
import { makeRootUseStore } from '../store/uses.js';
import { makeRootUseLedger } from './uses.js';
import { FileRoots, RootHoldings, RootReservations, RootUses } from '../contract/service/roots.js';
import type { RootId } from '../contract/wire/ids.js';
import { RootUnavailable } from '../contract/wire/roots.js';

const provenance = { kind: 'adoption', id: 'operator' };
const namespaceId = NamespaceId.make('test-healing');
const holder = { kind: 'terminal', id: 'holder' };
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const reservations = Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) });
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, reservations);

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* makeFileRootStore({ db });
  const roots = yield* makeRootRegistry({ store: records, namespaceId });
  const uses = yield* Effect.provideService(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), FileRoots, roots);
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'root-healing-' });
  const held = new Set<RootId>();
  const healingOver = (registry: FileRoots['Service'], counted: MachineUnits['Service']) =>
    makeRootHealing({ records }).pipe(
      Effect.provideService(FileRoots, registry),
      Effect.provideService(RootUses, uses),
      Effect.provideService(MachineUnits, counted),
      Effect.provideService(RootHoldings, { has: (_, rootId) => Effect.succeed(held.has(rootId)) }),
    );
  return { files, paths, records, roots, uses, units, home, held, healingOver, healing: yield* healingOver(roots, units) };
});

const run = <A, E>(
  work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(work, layers);

it.live('a registration whose directory is gone leaves the walk', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots, records, healing } = yield* fixture;
      const gone = paths.join(home, 'removed');
      const standing = paths.join(home, 'kept');
      yield* files.makeDirectory(gone, { recursive: true });
      yield* files.makeDirectory(standing, { recursive: true });
      const dead = yield* roots.register({ path: gone, provenance });
      const live = yield* roots.register({ path: standing, provenance });
      yield* files.remove(gone, { recursive: true });
      const retired = yield* healing.pass();
      expect(retired).toEqual([dead.rootId]);
      expect((yield* records.byId(dead.rootId))?.state).toBe('retired');
      expect((yield* records.byId(live.rootId))?.state).toBe('active');
      expect((yield* records.page(namespaceId, undefined)).map((root) => root.rootId)).toEqual([live.rootId]);
      expect(yield* healing.pass()).toEqual([]);
      expect((yield* roots.resolveFootprint(standing)).roots.map(({ root }) => root.rootId)).toEqual([live.rootId]);
    }),
  ),
);

it.live('a registration another consumer holds is left for a later pass', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots, records, units, uses, healing } = yield* fixture;
      const held = paths.join(home, 'held');
      yield* files.makeDirectory(held, { recursive: true });
      const root = yield* roots.register({ path: held, provenance });
      const footprint = yield* roots.resolveFootprint(held);
      const use = yield* units.write('RootHealing.use', (unit) => uses.reserve(unit, { footprint, consumer: holder, mode: 'shared' }));
      yield* files.remove(held, { recursive: true });
      expect(yield* healing.pass()).toEqual([]);
      expect((yield* records.byId(root.rootId))?.state).toBe('active');
      yield* units.write('RootHealing', (unit) => uses.release(unit, { useId: use.useId, consumer: holder, outcome: 'completed' }));
      expect(yield* healing.pass()).toEqual([root.rootId]);
      expect((yield* records.byId(root.rootId))?.state).toBe('retired');
    }),
  ),
);

it.live('recorded lines preserve a missing checkout until their retirement', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots, records, healing, held } = yield* fixture;
      const path = paths.join(home, 'recorded');
      yield* files.makeDirectory(path);
      const root = yield* roots.register({ path, provenance });
      held.add(root.rootId);
      yield* files.remove(path, { recursive: true });
      expect(yield* healing.pass()).toEqual([]);
      expect((yield* records.byId(root.rootId))?.state).toBe('active');
      held.delete(root.rootId);
      expect(yield* healing.pass()).toEqual([root.rootId]);
      expect((yield* records.byId(root.rootId))?.state).toBe('retired');
    }),
  ),
);

it.live('a pass over a registry with nothing gone opens no write unit', () =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots, units, healingOver } = yield* fixture;
      const standing = paths.join(home, 'kept');
      yield* files.makeDirectory(standing, { recursive: true });
      yield* roots.register({ path: standing, provenance });
      let writes = 0;
      const counted = yield* healingOver(roots, {
        ...units,
        write: (operation, work) => {
          writes += 1;
          return units.write(operation, work);
        },
      });
      expect(yield* counted.pass()).toEqual([]);
      expect(writes).toBe(0);
    }),
  ),
);

it.live.each(['probe', 'retirement'] as const)('an unreadable %s refuses healing and keeps the registration', (stage) =>
  run(
    Effect.gen(function* () {
      const { files, paths, home, roots, records, units, healingOver } = yield* fixture;
      const path = paths.join(home, 'unreadable');
      yield* files.makeDirectory(path);
      const root = yield* roots.register({ path, provenance });
      yield* files.remove(path, { recursive: true });
      const refusal = new RootUnavailable({ namespaceId, path, rootId: root.rootId, reason: 'filesystem', message: 'permission denied' });
      const healing = yield* healingOver(
        {
          ...roots,
          probe: stage === 'probe' ? () => refusal : roots.probe,
          retireMissing: stage === 'retirement' ? () => refusal : roots.retireMissing,
        },
        units,
      );
      const answer = yield* Effect.result(healing.pass());
      expect(answer._tag).toBe('Failure');
      if (answer._tag === 'Failure') expect(answer.failure).toEqual(refusal);
      expect((yield* records.byId(root.rootId))?.state).toBe('active');
    }),
  ),
);
