import { fixtureMigrations } from './migrations.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { world } from '@runlith/testbed/worlds';
import { SandboxResources, sandboxResources } from './sandboxFixture.js';
import { Clock, Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { machineFileLayer } from '../../platform/store/open.js';
import { project } from '../../projects/testing/doubles.js';

import { threadResourceStore, sandboxHolds } from '../../threads/testing/doubles.js';
import {
  dockerPreparation,
  dockerGuests,
  dockerSaid,
  preparedTreeStore,
  preparedTreesService,
  sandboxStore,
  sandboxServices,
} from '../../sandbox/testing/doubles.js';
import { Sandboxes } from '../../sandbox/contract/service/sandboxes.js';
import { PreparedTrees } from '../../sandbox/contract/service/preparedTrees.js';
import { SandboxHolds } from '../../sandbox/contract/service/holds.js';
import { rootFixture } from './graphFixture.js';

export const LIMITS = { pids: 512, memory: '2g', cpus: '2' };
export const REGISTRY = 'registry.npmjs.org';
export const failureOf = (result: { _tag: string; failure?: unknown }): string =>
  result._tag === 'Success' ? 'it succeeded' : result.failure instanceof Error ? result.failure.message : String(result.failure);
export type BuildOver = { network?: readonly string[]; setup?: readonly string[]; readiness?: readonly string[] };

export const makePreparedTreeWorld = Effect.fn('preparedTreeFixture.make')(function* () {
  const { context: platformContext, processes, checkout, head } = yield* SandboxResources;
  const roots = yield* Effect.acquireRelease(Effect.sync(rootFixture), (fixture) => Effect.orDie(fixture.releaseEffect));
  const fixture = yield* roots.openEffect.pipe(Effect.provide(platformContext));
  const storageRoot = yield* fixture.directory('artifacts');
  const exports = yield* fixture.directory('exports');
  const machine = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(fixture.root, 'db.sqlite'), fixtureMigrations, { durable: false }, processes))),
    ),
  );
  const context = Context.merge(platformContext, machine);
  const { db } = Context.get(context, MachineStore);
  const installation = `build-itest-${randomUUID()}`;
  const store = yield* preparedTreeStore().pipe(Effect.provide(context));
  const preparedTrees = preparedTreesService({
    store,
    preparation: dockerPreparation({ installation, closure: undefined }),
    checkoutOf: () => Effect.succeed(checkout),
    storageRoot,
  });
  const guests = dockerGuests({ installation, closure: undefined });
  const ledger = yield* threadResourceStore().pipe(Effect.provide(context));
  const owners = yield* sandboxServices({
    store: yield* sandboxStore().pipe(Effect.provide(context)),
    runtime: guests,
    checkoutOf: () => Effect.succeed(checkout),
    exportsRoot: exports,
  }).pipe(
    Effect.provideService(PreparedTrees, preparedTrees),
    Effect.provideService(SandboxHolds, sandboxHolds(ledger)),
    Effect.provide(context),
  );
  const sandboxes = Context.get(owners, Sandboxes);
  const created = yield* db
    .insert(project())
    .values({ name: 'build-fixture', repoKey: checkout, rootPath: checkout, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project().id })
    .get();
  if (created === undefined) return yield* Effect.die('the prepared-tree fixture project was not inserted');
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
  const build = Effect.fnUntraced(
    function* (over: BuildOver = {}) {
      return yield* Effect.result(
        preparedTrees.build({
          ownerId: 'operator',
          source: { kind: 'project', projectId, commit: head },
          limits: LIMITS,
          target: {},
          network: over.network === undefined ? { kind: 'none' } : { kind: 'https', hosts: over.network },
          setup: (over.setup ?? ['bun install --no-progress']).map((line) => ['/bin/sh', '-c', line]),
          readiness: over.readiness?.map((line) => ['/bin/sh', '-c', line]),
          dependencies: ['package.json'],
        }),
      );
    },
    (effect, _over: BuildOver = {}) => Effect.provide(effect, context),
  );
  const inGuest = Effect.fnUntraced(
    function* (sandbox: string, line: string) {
      const row = yield* sandboxes.byId(sandbox);
      if (row === null) return yield* Effect.die(`the fixture sandbox ${sandbox} is absent`);
      return yield* guests.run(row.runtime, ['/bin/sh', '-c', line]);
    },
    (effect, _sandbox: string, _line: string) => Effect.provide(effect, context),
  );
  const artifactOf = Effect.fnUntraced(function* (over: BuildOver = { network: [REGISTRY] }) {
    const built = yield* build(over);
    if (built._tag !== 'Success') return yield* Effect.die(new Error(`the suite's artifact did not build: ${failureOf(built)}`));
    return built.success.id;
  });
  return { context, preparedTrees, sandboxes, guests, store, checkout, storageRoot, head, projectId, made, build, inGuest, artifactOf };
});

export type PreparedTreeWorld = Effect.Success<ReturnType<typeof makePreparedTreeWorld>>;
export class PreparedTreeFixture extends Context.Service<PreparedTreeFixture, PreparedTreeWorld>()('testing/PreparedTreeFixture') {}
export const preparedTreeFixture = () =>
  Layer.effect(PreparedTreeFixture, makePreparedTreeWorld()).pipe(Layer.provide(world(sandboxResources, { source: 'prepared' })));
