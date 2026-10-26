import { readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Context, Effect, Schema, Semaphore } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { AdapterState } from '../contract/wire/catalog.js';
import type { ProviderRegistry } from '../contract/service/registry.js';
import type { AdapterInstallRefusal, AdapterInstalls } from '../contract/service/adapters.js';
import { fetchInto, installDependencies, sourceOf } from './fetch.js';
import { type AdapterInstall, RECORD_FILE, readInstalls, RecordUnreadable, writeInstalls } from './record.js';

const STAGING = '.staging-';

type Placed = { readonly id: string; readonly source: string; readonly version: string; readonly directory: string };

const Manifest = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  version: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

const folderOf = (id: string): string => id.replace('/', '+');

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const refused = (source: string) => (error: unknown) =>
  new GateRefusal('adapter-install', `The adapter at ${source} could not be installed: ${reasonOf(error)}`, [
    'correct the source — an npm package, a GitHub repository or a local directory holding the adapter package — and install again',
  ]);

const unknown = (id: string) =>
  new GateRefusal('unknown-adapter', `No adapter ${id} is installed on this machine.`, ['name an adapter the provider catalog lists']);

const homelessRefusal = new GateRefusal('adapter-install', 'This server keeps no machine directory, so it installs no adapters.', [
  'install the adapter through a server that runs on a database file',
]);

export const homeless: Context.Service.Shape<typeof AdapterInstalls> = {
  install: () => Effect.fail(homelessRefusal),
  update: () => Effect.fail(homelessRefusal),
  remove: () => Effect.fail(homelessRefusal),
  disable: () => Effect.fail(homelessRefusal),
  enable: () => Effect.fail(homelessRefusal),
};

export const makeMachineAdapters = (input: { readonly machine: string; readonly registry: ProviderRegistry['Service'] }) => {
  const { machine, registry } = input;
  const lock = Semaphore.makeUnsafe(1);

  const names = async (): Promise<readonly string[]> => {
    try {
      return await readdir(machine);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  };

  const place = async (source: string): Promise<Placed> => {
    const staging = join(machine, `${STAGING}${Date.now()}-${process.pid}`);
    const unpacked = join(staging, 'package');
    try {
      await fetchInto(sourceOf(source), staging, unpacked);
      const manifest = decodeManifest(await readFile(join(unpacked, 'package.json'), 'utf8'));
      const version = manifest.version ?? '0.0.0';
      const needed = { ...manifest.dependencies, ...manifest.optionalDependencies };
      if (Object.keys(needed).length > 0) await installDependencies(unpacked);
      const taken = new Set(await names());
      const base = `${folderOf(manifest.name)}@${version}`;
      const directory = taken.has(base) ? `${base}+${Date.now()}` : base;
      await rename(unpacked, join(machine, directory));
      return { id: manifest.name, source, version, directory };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  };

  const sweepVersions = async (id: string, kept: string | null): Promise<void> => {
    const prefix = `${folderOf(id)}@`;
    for (const name of await names()) {
      if (name.startsWith(prefix) && name !== kept) await rm(join(machine, name), { recursive: true, force: true });
    }
  };

  const stateAfterReload = (id: string): Effect.Effect<AdapterState, GateRefusal<AdapterInstallRefusal>> =>
    Effect.flatMap(registry.reload, (catalog) => {
      const state = catalog.adapters.findLast((adapter) => adapter.origin === 'machine' && adapter.id === id);
      return state === undefined ? Effect.fail(refused(id)(new Error('the registry did not read it back'))) : Effect.succeed(state);
    });

  const recorded = (id: string): Effect.Effect<AdapterInstall, GateRefusal<AdapterInstallRefusal>> =>
    Effect.flatMap(readInstalls(machine).pipe(Effect.mapError(refused(id))), (installs) => {
      const found = installs.find((install) => install.id === id);
      return found === undefined ? Effect.fail(unknown(id)) : Effect.succeed(found);
    });

  const installing = Effect.fnUntraced(function* (source: string) {
    const standing = yield* readInstalls(machine).pipe(Effect.mapError(refused(source)));
    const placed = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => place(source), catch: refused(source) }));
    const kept = standing.find((install) => install.id === placed.id);
    yield* writeInstalls(machine, [
      ...standing.filter((install) => install.id !== placed.id),
      { ...placed, enabled: kept?.enabled ?? true },
    ]).pipe(Effect.mapError(refused(source)));
    return yield* stateAfterReload(placed.id);
  });

  const switched = (id: string, enabled: boolean) =>
    lock.withPermits(1)(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const standing = yield* readInstalls(machine).pipe(Effect.mapError(refused(id)));
          if (!standing.some((install) => install.id === id)) return yield* unknown(id);
          yield* writeInstalls(
            machine,
            standing.map((install) => (install.id === id ? { ...install, enabled } : install)),
          ).pipe(Effect.mapError(refused(id)));
          return yield* stateAfterReload(id);
        }),
      ),
    );

  return {
    install: Effect.fn('AdapterInstalls.install')(function* (source) {
      return yield* lock.withPermits(1)(installing(source));
    }),
    update: Effect.fn('AdapterInstalls.update')(function* (id) {
      return yield* lock.withPermits(1)(Effect.flatMap(recorded(id), (install) => installing(install.source)));
    }),
    remove: Effect.fn('AdapterInstalls.remove')(function* (id) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const standing = yield* readInstalls(machine).pipe(Effect.mapError(refused(id)));
          if (!standing.some((install) => install.id === id)) return yield* unknown(id);
          yield* writeInstalls(
            machine,
            standing.filter((install) => install.id !== id),
          ).pipe(Effect.mapError(refused(id)));
          yield* registry.reload;
          yield* Effect.tryPromise({ try: () => sweepVersions(id, null), catch: refused(id) });
        }),
      );
    }),
    disable: Effect.fn('AdapterInstalls.disable')(function* (id) {
      return yield* switched(id, false);
    }),
    enable: Effect.fn('AdapterInstalls.enable')(function* (id) {
      return yield* switched(id, true);
    }),
    sweep: Effect.fn('MachineAdapters.sweep')(function* () {
      const installs = yield* readInstalls(machine);
      const kept = new Set([RECORD_FILE, ...installs.map((install) => install.directory)]);
      yield* Effect.tryPromise({
        try: async () => {
          for (const name of await names()) {
            if (!kept.has(name)) await rm(join(machine, name), { recursive: true, force: true });
          }
        },
        catch: (error) => new RecordUnreadable({ path: machine, reason: reasonOf(error) }),
      });
    }),
  };
};

export type MachineAdapters = ReturnType<typeof makeMachineAdapters>;
