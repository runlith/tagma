import { existsSync, renameSync } from 'node:fs';
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { type Context, Effect, Result, Schema, Semaphore } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { AdapterState } from '../contract/wire/catalog.js';
import type { ProviderRegistry } from '../contract/service/registry.js';
import type { AdapterInstallRefusal, AdapterInstalls, PackageHolders } from '../contract/service/adapters.js';
import { fetchInto, installDependencies, sourceOf } from './fetch.js';
import { type AdapterInstall, RECORD_FILE, readInstalls, RecordUnreadable, writeInstalls } from './record.js';
import { HARNESS_INDEX_FILE } from './harnessIndex.js';

const STAGING = '.staging-';
const RETIRED = '.retired-';

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
  new GateRefusal('unknown-adapter', `No adapter ${id} is installed on this machine.`, [
    'name an adapter of origin machine that read_adapters lists',
  ]);

const homelessRefusal = new GateRefusal('adapter-install', 'This server keeps no machine directory, so it installs no adapters.', [
  'install the adapter through a server that runs on a database file',
]);

export const homeless: Context.Service.Shape<typeof AdapterInstalls> = {
  install: () => Effect.fail(homelessRefusal),
  update: () => Effect.fail(homelessRefusal),
  remove: () => Effect.fail(homelessRefusal),
  disable: () => Effect.fail(homelessRefusal),
  enable: () => Effect.fail(homelessRefusal),
  hold: () => Effect.succeed(true),
};

export const makeMachineAdapters = (input: {
  readonly machine: string;
  readonly registry: ProviderRegistry['Service'];
  readonly holders: PackageHolders['Service'];
}) => {
  const { machine, registry, holders } = input;
  const lock = Semaphore.makeUnsafe(1);
  const leases = new Map<string, number>();
  const handed = new Map<string, number>();
  const placing = new Set<string>();
  let moment = 0;

  const folderOfDirectory = (directory: string): string | null => {
    const folder = relative(machine, directory);
    return folder === '' || folder.startsWith('..') || folder.includes(sep) || isAbsolute(folder) ? null : folder;
  };

  const folders = (directories: Iterable<string>): readonly string[] =>
    [...directories].flatMap((directory) => folderOfDirectory(directory) ?? []);

  const unreadable = (error: unknown) => new RecordUnreadable({ path: machine, reason: reasonOf(error) });

  const sessions = holders.recorded.pipe(Effect.map(folders), Effect.mapError(unreadable));

  const live = (): ReadonlySet<string> =>
    new Set([
      ...leases.keys(),
      ...handed.keys(),
      ...placing,
      ...folders(holders.standing()),
      ...folders(registry.pinned()),
      ...folders(registry.current().packages.values()),
    ]);

  const collect = Effect.fn('MachineAdapters.sweep')(function* (boot: boolean) {
    const mark = ++moment;
    const installs = yield* readInstalls(machine);
    const kept = new Set([RECORD_FILE, HARNESS_INDEX_FILE, ...installs.map((install) => install.directory), ...(yield* sessions)]);
    yield* Effect.tryPromise({
      try: async () => {
        const listed = await names();
        const standing = live();
        const retired: string[] = [];
        for (const name of listed) {
          if (kept.has(name) || standing.has(name) || (!boot && name.startsWith('.')) || !existsSync(join(machine, name))) continue;
          const away = join(machine, `${RETIRED}${++moment}-${name}`);
          renameSync(join(machine, name), away);
          retired.push(away);
        }
        for (const away of retired) await rm(away, { recursive: true, force: true });
      },
      catch: unreadable,
    });
    for (const [folder, at] of handed) if (at < mark) handed.delete(folder);
  });

  const collected = (boot: boolean) =>
    Effect.flatMap(Effect.result(collect(boot)), (done) =>
      Result.isFailure(done)
        ? Effect.logWarning('earlier adapter versions stay until the next collection', { reason: done.failure.reason })
        : Effect.void,
    );

  const released = (folder: string, recorded: boolean) =>
    Effect.suspend(() => {
      const left = (leases.get(folder) ?? 1) - 1;
      if (left > 0) leases.set(folder, left);
      else leases.delete(folder);
      if (recorded) {
        handed.set(folder, ++moment);
        return Effect.void;
      }
      return left > 0 || live().has(folder) ? Effect.void : collected(false);
    });

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
      placing.add(directory);
      await rename(unpacked, join(machine, directory));
      return { id: manifest.name, source, version, directory };
    } finally {
      await rm(staging, { recursive: true, force: true });
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
    const state = yield* writeInstalls(machine, [
      ...standing.filter((install) => install.id !== placed.id),
      { ...placed, enabled: kept?.enabled ?? true },
    ]).pipe(
      Effect.mapError(refused(source)),
      Effect.andThen(stateAfterReload(placed.id)),
      Effect.ensuring(Effect.sync(() => void placing.delete(placed.directory))),
    );
    yield* collected(false);
    return state;
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
          yield* collected(false);
        }),
      );
    }),
    disable: Effect.fn('AdapterInstalls.disable')(function* (id) {
      return yield* switched(id, false);
    }),
    enable: Effect.fn('AdapterInstalls.enable')(function* (id) {
      return yield* switched(id, true);
    }),
    hold: (directory: string | null, recorded = false) => {
      const folder = directory === null ? null : folderOfDirectory(directory);
      if (folder === null) return Effect.succeed(true);
      return Effect.acquireRelease(
        Effect.sync(() => {
          if (!existsSync(join(machine, folder))) return false;
          leases.set(folder, (leases.get(folder) ?? 0) + 1);
          return true;
        }),
        (held) => (held ? released(folder, recorded) : Effect.void),
      );
    },
    sweep: () => collect(true),
  };
};

export type MachineAdapters = ReturnType<typeof makeMachineAdapters>;
