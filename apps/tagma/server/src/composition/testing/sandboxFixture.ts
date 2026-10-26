import { fixtureMigrations } from './migrations.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { kind, world } from '@runlith/testbed/worlds';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { machineFileLayer } from '../../platform/store/open.js';
import { project } from '../../projects/testing/doubles.js';
import { scopeRecord } from '../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { threadResourceStore } from '../../threads/testing/doubles.js';
import { threadStore } from '../../native-harness/testing/doubles.js';
import {
  dockerPreparation,
  dockerGuests,
  dockerSaid,
  installationMark,
  KIND_LABEL,
  INSTALLATION_LABEL,
  SUBJECT_LABEL,
} from '../../sandbox/testing/doubles.js';
import { GuestWorlds } from '../../sandbox/contract/service/guests.js';
import { Sandboxes } from '../../sandbox/contract/service/sandboxes.js';
import { PreparedTrees } from '../../sandbox/contract/service/preparedTrees.js';
import { SandboxHolds } from '../../sandbox/contract/service/holds.js';
import { preparedTreeStore, preparedTreesService, sandboxStore, sandboxServices } from '../../sandbox/testing/doubles.js';
import { sandboxHolds } from '../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../manifest.js';
import { rootFixture } from './graphFixture.js';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const platform = Layer.mergeAll(host, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));

type SandboxSource = 'snapshot' | 'prepared' | 'import' | 'empty';
type ResourceParams = { readonly source: SandboxSource };

const makeResources = Effect.fn('sandboxFixture.seed')(function* (source: SandboxSource, home: string) {
  const context = yield* Layer.build(platform);
  const files = Context.get(context, FileSystem.FileSystem);
  const processes = yield* heldPool;
  const checkout = join(home, 'source');
  yield* files.makeDirectory(checkout, { recursive: true });
  let first = '';
  let head = '';
  if (source !== 'empty') {
    yield* files.makeDirectory(join(checkout, 'src'));
    if (source === 'snapshot') {
      yield* files.makeDirectory(join(checkout, '.tagma'));
      yield* files.writeFileString(join(checkout, 'src', 'answer.txt'), 'the first tree\n');
      yield* files.writeFileString(join(checkout, '.tagma', 'block.md'), 'graph content\n');
    } else {
      yield* files.writeFileString(
        join(checkout, 'package.json'),
        `${JSON.stringify({ name: 'fixture', private: true, dependencies: source === 'prepared' ? { typescript: '5.9.2' } : {} }, null, 2)}\n`,
      );
      yield* files.writeFileString(
        join(checkout, 'src', 'answer.ts'),
        source === 'prepared' ? 'export const answer: number = 42;\n' : 'export const answer = 1;\n',
      );
    }
    const git = Effect.fn(source === 'prepared' ? 'preparedTreeFixture.git' : 'sandboxFixture.git')(function* (...args: string[]) {
      const ran = yield* spawnedEffect(['git', '-C', checkout, ...args], { env: process.env });
      if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`));
      return ran.stdout.toString();
    });
    yield* git('init', '-q', '-b', 'main');
    if (source === 'import') {
      yield* git('config', 'user.email', 'fixture@tagma');
      yield* git('config', 'user.name', 'fixture');
    }
    yield* git('add', '.');
    yield* git('-c', 'user.email=fixture@tagma', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'first');
    first = (yield* git('rev-parse', 'HEAD')).trim();
    head = first;
    if (source === 'snapshot') {
      yield* files.writeFileString(join(checkout, 'src', 'answer.txt'), 'the second tree\n');
      yield* git('add', '.');
      yield* git('-c', 'user.email=fixture@tagma', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'second');
      head = (yield* git('rev-parse', 'HEAD')).trim();
      yield* files.writeFileString(join(checkout, 'src', 'uncommitted.txt'), 'never in a snapshot\n');
    }
  }
  return { context, files, processes, checkout, first, head };
});

export class SandboxResources extends Context.Service<SandboxResources, Effect.Success<ReturnType<typeof makeResources>>>()(
  'testing/SandboxResources',
) {}

export const sandboxResources = kind(SandboxResources, (params: ResourceParams, home: string) => makeResources(params.source, home));

export const makeSandboxWorld = Effect.fn('sandboxFixture.make')(function* () {
  const { context: platformContext, processes, checkout, first, head } = yield* SandboxResources;
  const roots = yield* Effect.acquireRelease(Effect.sync(rootFixture), (fixture) => Effect.orDie(fixture.releaseEffect));
  const fixture = yield* roots.openEffect.pipe(Effect.provide(platformContext));
  const exports = yield* fixture.directory('exports');
  const machine = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(fixture.root, 'db.sqlite'), fixtureMigrations, { durable: false }, processes))),
    ),
  );
  const context = Context.merge(platformContext, machine);
  const { db } = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const records = yield* makeThreadRecords.pipe(Effect.provide(context));
  const threads = yield* threadStore(records, ENTRY_KINDS).pipe(Effect.provide(context));
  const store = yield* sandboxStore().pipe(Effect.provide(context));
  const ledger = yield* threadResourceStore().pipe(Effect.provide(context));
  const installation = `itest-${randomUUID()}`;
  const backend = dockerGuests({ installation, closure: undefined });
  const preparedTrees = preparedTreesService({
    store: yield* preparedTreeStore().pipe(Effect.provide(context)),
    preparation: dockerPreparation({ installation, closure: undefined }),
    checkoutOf: () => Effect.succeed(checkout),
    storageRoot: join(exports, 'artifacts'),
  });
  const owners = yield* sandboxServices({ store, runtime: backend, checkoutOf: () => Effect.succeed(checkout), exportsRoot: exports }).pipe(
    Effect.provideService(PreparedTrees, preparedTrees),
    Effect.provideService(SandboxHolds, sandboxHolds(ledger)),
    Effect.provide(context),
  );
  const sandboxes = Context.get(owners, Sandboxes);
  const worlds = Context.get(owners, GuestWorlds);
  const created = yield* db
    .insert(project())
    .values({ name: 'fixture', repoKey: checkout, rootPath: checkout, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project().id })
    .get();
  if (created === undefined) return yield* Effect.die('the sandbox fixture project was not inserted');
  const projectId = created.id;
  const made: string[] = [];
  yield* fixture.producer(
    'Docker workloads',
    Effect.gen(function* () {
      if (made.length === 0) return;
      yield* dockerSaid(['rm', '--force', '--volumes', ...made], 'remove the test guests');
      yield* dockerSaid(['volume', 'rm', '--force', ...made], 'remove the test volumes');
    }).pipe(Effect.provide(context)),
  );
  const prepare = Effect.fnUntraced(
    function* (commit = head, exclude: readonly string[] = [':(exclude).tagma']) {
      const record = yield* sandboxes.prepare({
        ownerId: 'operator',
        source: { kind: 'project', projectId, commit },
        limits: { pids: 128, memory: '512m', cpus: '1' },
        exclude,
      });
      made.push(record.runtime.container);
      return record;
    },
    (effect, _commit = head, _exclude: readonly string[] = [':(exclude).tagma']) => Effect.provide(effect, context),
  );
  const boundThread = Effect.fnUntraced(
    function* (sandbox: string) {
      const row = yield* threads.insert({ ownerId: 'operator', agentId: 'any-agent', hostKind: 'sandbox', hostId: sandbox });
      yield* scopeRecord(db, row.id, { projectId });
      yield* units.write('sandboxFixture.boundThread', (tx) =>
        sandboxes.admit({ host: { kind: 'sandbox', id: sandbox }, child: row, projectId, carried: 'fresh' }, tx),
      );
      return row;
    },
    (effect, _sandbox: string) => Effect.provide(effect, context),
  );
  const readInGuest = Effect.fnUntraced(
    function* (thread: ThreadRow, path: string) {
      const { world } = yield* worlds.world(thread);
      if (world.files === undefined) return yield* Effect.die('the guest world carries no files capability');
      return yield* FileSystem.FileSystem.use((guest) =>
        Effect.gen(function* () {
          return {
            text: yield* guest.readFileString(path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null))),
            exists: yield* guest.exists(path),
          };
        }),
      ).pipe(Effect.provide(world.files));
    },
    Effect.scoped,
    (effect, _thread: ThreadRow, _path: string) => Effect.provide(effect, context),
  );
  const ownedLabels = (subject: string): readonly string[] => [
    '--label',
    `${INSTALLATION_LABEL()}=${installationMark(installation)}`,
    '--label',
    `${KIND_LABEL()}=workload`,
    '--label',
    `${SUBJECT_LABEL()}=${subject}`,
  ];
  return {
    context,
    sandboxes,
    worlds,
    backend,
    store,
    ledger,
    threads,
    checkout,
    first,
    head,
    projectId,
    made,
    prepare,
    boundThread,
    readInGuest,
    ownedLabels,
  };
});

export type SandboxItestWorld = Effect.Success<ReturnType<typeof makeSandboxWorld>>;
export class SandboxFixture extends Context.Service<SandboxFixture, SandboxItestWorld>()('testing/SandboxFixture') {}
export const sandboxFixture = () =>
  Layer.effect(SandboxFixture, makeSandboxWorld()).pipe(Layer.provide(world(sandboxResources, { source: 'snapshot' })));
