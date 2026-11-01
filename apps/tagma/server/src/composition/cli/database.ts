import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { snapshotAssembly } from '../snapshots.js';
import { lockDataDirectory, type DataDirectoryLock } from '../../platform/lock/dataDirectory.js';
import { SnapshotFailed, type StoreSnapshots } from '../../platform/contract/service/snapshots.js';
import { CurrentInvocation, print, refuse } from '../../platform/cli/verb.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { storeLayer } from '../../platform/store/open.js';
import { DATABASE_FILE, dataDirectory } from '../../installation/contract/wire/layout.js';
import { migrationsFolder } from '../../installation/closure/read.js';
import type { Build } from '../build.js';
import { participantsOf } from '../manifest.js';
import { rowFactsOf } from '../../platform/contract/service/manifest.js';

const inStore = Effect.fnUntraced(function* <A, E>(
  build: Build,
  selected: Option.Option<string>,
  scope: 'machine' | 'installation',
  run: (
    path: string,
    snapshots: StoreSnapshots['Service'],
    seeds: string,
    lock: DataDirectoryLock,
    processes: ProcessPool,
  ) => Effect.Effect<A, E>,
) {
  const invocation = yield* CurrentInvocation;
  const data = dataDirectory(build.channel, invocation.env);
  if (data === null) return yield* new SnapshotFailed({ path: '', reason: 'TAGMA_DATABASE_PATH is required when HOME is unavailable' });
  const machine = resolve(invocation.cwd, invocation.env.TAGMA_DATABASE_PATH?.trim() || join(data, DATABASE_FILE));
  const path = resolve(
    invocation.cwd,
    Option.getOrElse(selected, () => machine),
  );
  if (scope === 'machine' && path !== machine) {
    refuse(
      'machine-store-required',
      `${path} is not the machine store ${machine}; offline migration cannot select another store's migration owner`,
      [`omit --store or select ${machine}`, 'graph mirrors migrate when their graph owner opens them through the server'],
    );
  }
  const root = dirname(machine);
  const inside = relative(root, path);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return yield* new SnapshotFailed({ path, reason: 'the store must belong to this installation data directory' });
  }
  const processes = new ProcessPool(undefined, 'stop', undefined, childHosting);
  const { modules } = yield* Effect.promise(build.parts);
  const snapshots = yield* snapshotAssembly(participantsOf(modules), machine, root, processes, () => rowFactsOf(modules));
  return yield* Effect.acquireUseRelease(
    lockDataDirectory(root).pipe(Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.message }))),
    (lock) => run(path, snapshots, invocation.env.TAGMA_SEED_DIRECTORY?.trim() || invocation.temporary, lock, processes),
    (lock) => lock.release,
  ).pipe(Effect.ensuring(Effect.promise(() => processes.close())));
});

const restoreSnapshot = (build: Build) =>
  Command.make(
    'restore-snapshot',
    {
      store: Flag.String('store').pipe(Flag.optional),
      acceptLoss: Flag.String('accept-loss').pipe(
        Flag.atLeast(0),
        Flag.withDescription('accept a named missing rollout, threads:project/thread; repeat for each loss'),
      ),
    },
    ({ store, acceptLoss }) =>
      inStore(build, store, 'installation', (path, snapshots) => snapshots.restore(path, { acceptLoss })).pipe(
        Effect.flatMap((answer) => print(answer, true)),
      ),
  ).pipe(Command.withDescription('restore the pre-migration store and rollout cut with the server stopped'));

const migrate = (build: Build) =>
  Command.make(
    'migrate',
    {
      store: Flag.String('store').pipe(Flag.optional),
      withoutSnapshot: Flag.Boolean('without-snapshot').pipe(Flag.withDefault(false)),
      confirm: Flag.Boolean('confirm').pipe(Flag.withDefault(false)),
    },
    ({ store, withoutSnapshot, confirm }) =>
      Effect.gen(function* () {
        if (withoutSnapshot && !confirm)
          refuse('confirmation-required', 'migration without a snapshot has no rollback guarantee', [
            'repeat with --without-snapshot --confirm to record and accept this loss of protection',
          ]);
        const files = yield* FileSystem.FileSystem;
        const schema = yield* inStore(build, store, 'machine', (path, snapshots, seeds, _lock, processes) =>
          Effect.gen(function* () {
            const existing = yield* files
              .stat(path)
              .pipe(
                Effect.mapError((cause) => new SnapshotFailed({ path, reason: `migration requires an existing store: ${cause.message}` })),
              );
            if (existing.type !== 'File') return yield* new SnapshotFailed({ path, reason: 'migration requires an existing store file' });
            return yield* Effect.map(MachineStore, (store) => store.schema).pipe(
              Effect.provide(
                storeLayer(MachineStore, path, { folder: migrationsFolder, seeds, snapshots }, { withoutSnapshot }, processes),
              ),
            );
          }),
        );
        yield* print({ schema, withoutSnapshot }, true);
      }),
  ).pipe(Command.withDescription('apply pending machine-store migrations offline; bypassing the snapshot requires --confirm'));

export const databaseCommand = (build: Build) =>
  Command.make('db').pipe(
    Command.withDescription('offline store migration and recovery'),
    Command.withSubcommands([restoreSnapshot(build), migrate(build)]),
  );
