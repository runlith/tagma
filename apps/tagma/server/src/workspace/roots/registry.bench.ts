import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer, Path } from 'effect';
import { sql } from 'drizzle-orm';
import { NamespaceId } from '@runlith/files/namespace';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from './registry.js';
import { RootReservations } from '../contract/service/roots.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer);

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const { db } = yield* MachineStore;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'root-admission-bench-' });
      let stats = 0;
      let realPaths = 0;
      const measured: FileSystem.FileSystem = {
        ...files,
        stat: (path) =>
          Effect.suspend(() => {
            stats += 1;
            return files.stat(path);
          }),
        realPath: (path) =>
          Effect.suspend(() => {
            realPaths += 1;
            return files.realPath(path);
          }),
      };
      const records = yield* makeFileRootStore({ db });
      const roots = yield* makeRootRegistry({ store: records, namespaceId: NamespaceId.make('bench') }).pipe(
        Effect.provideService(FileSystem.FileSystem, measured),
        Effect.provideService(RootReservations, { holding: () => Effect.succeed(new Map()) }),
      );
      let registered = 0;
      for (const count of [10, 100, 1000]) {
        while (registered < count) {
          const path = paths.join(home, String(registered++));
          yield* files.makeDirectory(path);
          yield* roots.register({ path, provenance: { kind: 'bench', id: path } });
        }
        const samples: { ms: number; stats: number; realPaths: number }[] = [];
        for (let sample = 0; sample < 6; sample++) {
          stats = 0;
          realPaths = 0;
          const started = performance.now();
          const answer = yield* roots.resolveFootprint(paths.join(home, '0'));
          if (answer.roots.length !== 1) return yield* Effect.die(new Error(`Expected one overlap, got ${answer.roots.length}`));
          samples.push({ ms: performance.now() - started, stats, realPaths });
        }
        const scope = roots.scope();
        const scoped: { ms: number; stats: number; realPaths: number }[] = [];
        for (let sample = 0; sample < 6; sample++) {
          stats = 0;
          realPaths = 0;
          const started = performance.now();
          const answer = yield* scope.resolve(paths.join(home, '0'));
          if (answer.roots.length !== 1) return yield* Effect.die(new Error(`Expected one overlap, got ${answer.roots.length}`));
          scoped.push({ ms: performance.now() - started, stats, realPaths });
        }
        console.log(JSON.stringify({ roots: count, samples, scoped }));
      }
      const revision = yield* records.revision(roots.namespaceId);
      const plan = yield* db.all<{ detail: string }>(sql`
    explain query plan select file_root_namespace.revision, file_root.* from file_root_namespace
    left join file_root on file_root.namespace_id = file_root_namespace.namespace_id and file_root.changed_revision > ${revision}
    where file_root_namespace.namespace_id = ${roots.namespaceId}
  `);
      console.log(JSON.stringify({ changesSincePlan: plan.map((row) => row.detail) }));
    }),
  ).pipe(Effect.provide(layers)),
);
