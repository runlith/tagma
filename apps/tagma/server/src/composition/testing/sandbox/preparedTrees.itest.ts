import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import type { PreparationReceipt } from '../../../sandbox/contract/wire/preparedTree.js';
import { PreparedTreeUnavailable } from '../../../sandbox/contract/service/preparedTrees.js';
import { preparedTreeStore, preparedTreesService } from '../../../sandbox/testing/doubles.js';
import type { PreparationBackend } from '../../../sandbox/contract/service/backends.js';

const OWNER = 'operator';
const IMAGE = { reference: 'guest:abc', digest: 'sha256:abc', revision: 'abc' };
const LIMITS = { pids: 128, memory: '512m', cpus: '1' };
const RECIPE = {
  source: { kind: 'empty' as const },
  limits: LIMITS,
  target: {},
  network: { kind: 'none' as const },
  setup: [['/bin/sh', '-c', 'bun install']],
  ownerId: OWNER,
};
class PreparationScript {
  readonly builds = new Map<string, PreparationReceipt>();
  readinessCode = 0;
  closeFails = 0;
  closeRefused = false;
  engineDown = false;
}
const makePreparation = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const script = new PreparationScript();
  const receipt = (build: string): PreparationReceipt => ({
    backend: 'docker',
    container: `b-${build}`,
    volume: `b-${build}`,
    network: `b-${build}-net`,
    proxy: `b-${build}-proxy`,
    check: `b-${build}-check`,
  });
  const backend: PreparationBackend = {
    backend: 'docker',
    receipt,
    target: () => Effect.succeed({ image: IMAGE, platform: 'linux/arm64' }),
    open: (at) =>
      Effect.sync(() => {
        script.builds.set(at.container, at);
      }),
    unpack: () => Effect.void,
    run: () => Effect.succeed({ code: 0, output: '' }),
    revoke: () => Effect.void,
    seal: (at, into) =>
      files.writeFileString(into, 'sealed bytes').pipe(
        Effect.as({ digest: 'f'.repeat(64), bytes: 12 }),
        Effect.mapError((error) => new PreparedTreeUnavailable({ preparedTree: at.container, reason: error.message })),
      ),
    check: (_receipt, _plan, _archive, commands) =>
      Effect.sync(() =>
        commands.map((command) => ({
          command,
          code: script.readinessCode,
          output: script.readinessCode === 0 ? '' : 'no',
        })),
      ),
    close: Effect.fnUntraced(function* (at) {
      if (script.closeRefused || script.closeFails > 0) {
        script.closeFails = Math.max(0, script.closeFails - 1);
        return yield* new PreparedTreeUnavailable({ preparedTree: at.container, reason: 'the engine refused to remove it' });
      }
      script.builds.delete(at.container);
    }),
    receipts: () => Effect.sync(() => (script.engineDown ? null : [...script.builds.values()])),
  };
  return { script, backend };
});
const makeCase = Effect.gen(function* () {
  const platform = yield* Layer.build(BunFileSystem.layer);
  const files = Context.get(platform, FileSystem.FileSystem);
  const machine = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, yield* sharedPool))),
    ),
  );
  const context = Context.merge(platform, machine);
  const storageRoot = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-prepared-' });
  const store = yield* preparedTreeStore().pipe(Effect.provide(context));
  const { script, backend } = yield* makePreparation.pipe(Effect.provide(context));
  const preparedTrees = preparedTreesService({ store, preparation: backend, checkoutOf: () => Effect.succeed('/nowhere'), storageRoot });
  const { db } = Context.get(context, MachineStore);
  const created = yield* db
    .insert(project())
    .values({ name: 'artifacts', repoKey: '/artifacts', rootPath: '/artifacts', createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project().id })
    .get();
  if (created === undefined) return yield* Effect.die('the artifact fixture project was not inserted');
  return { context, files, preparedTrees, store, script, backend, projectId: created.id, storageRoot };
});
type Case = Effect.Success<typeof makeCase>;
const withCase = <A, E, R>(body: (world: Case) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(makeCase, (world) => Effect.provide(body(world), world.context));

it.live('a build publishes its sealed artifact after offline readiness succeeds', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const record = yield* world.preparedTrees.build({
        ...RECIPE,
        network: { kind: 'https', hosts: ['registry.npmjs.org'] },
        readiness: [['node', '-v']],
      });
      expect(record.state).toBe('ready');
      expect(record.manifest?.network).toEqual({ kind: 'https', hosts: ['registry.npmjs.org'] });
      expect(record.manifest?.archiveDigest).toBe('f'.repeat(64));
      expect(record.manifest?.readinessResults.map((result) => result.code)).toEqual([0]);
      expect(record.resourcesReleased).toBe(true);
      expect(yield* world.files.exists(join(world.storageRoot, record.id, 'tree.tar'))).toBe(true);
    }),
  ),
);

it.live('failed readiness publishes no seedable artifact', () =>
  withCase((world) =>
    Effect.gen(function* () {
      world.script.readinessCode = 1;
      const refused = yield* world.preparedTrees.build({ ...RECIPE, readiness: [['node', '-v']] }).pipe(Effect.flip);
      expect(refused.message).toContain('failed in an offline copy');
      const rows = yield* world.store.standing();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe('failed');
      const copied = yield* world.preparedTrees.acquire(rows[0]!.id, { ownerId: OWNER, projectId: world.projectId }).pipe(Effect.flip);
      expect(copied.message).toContain('it is failed');
    }),
  ),
);

it.live('boot condemns an unfinished build and sweeps its resources', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const halfway = crypto.randomUUID();
      const receipt = world.backend.receipt(halfway);
      yield* world.store.open({ id: halfway, projectId: world.projectId, ownerId: OWNER, receipt });
      world.script.builds.set(receipt.container, receipt);
      expect(yield* world.preparedTrees.condemnUnfinished()).toContain(halfway);
      expect((yield* world.preparedTrees.reconcile()).engine).toBe('read');
      const row = yield* world.store.byId(halfway);
      expect(row?.state).toBe('failed');
      expect(row?.failureReason).toContain('did not finish');
      expect(row?.resourcesReleased).toBe(true);
      expect(yield* world.backend.receipts()).toEqual([]);
    }),
  ),
);

it.live('an engine-refused cleanup stays unfinished until the next reconciliation succeeds', () =>
  withCase((world) =>
    Effect.gen(function* () {
      world.script.closeFails = 1;
      const record = yield* world.preparedTrees.build(RECIPE);
      expect(record.state).toBe('ready');
      expect(record.resourcesReleased).toBe(false);
      expect((yield* world.preparedTrees.reconcile()).cleaned).toContain(record.id);
      expect((yield* world.store.byId(record.id))?.resourcesReleased).toBe(true);
      expect(yield* world.backend.receipts()).toEqual([]);
    }),
  ),
);

it.live('reconciliation reports a retained cleanup and clears it only after the backend allows removal', () =>
  withCase((world) =>
    Effect.gen(function* () {
      world.script.closeRefused = true;
      const record = yield* world.preparedTrees.build(RECIPE);
      expect(record.resourcesReleased).toBe(false);
      const reconciled = yield* world.preparedTrees.reconcile();
      expect(reconciled.cleaned).not.toContain(record.id);
      expect(reconciled.retained.map((held) => held.preparedTree)).toContain(record.id);
      expect(reconciled.retained[0]?.reason).toContain('refused to remove it');
      const held = yield* world.store.byId(record.id);
      expect(held?.resourcesReleased).toBe(false);
      expect(held?.cleanupReason).toContain('refused to remove it');
      expect(held?.failureReason).toBeNull();
      world.script.closeRefused = false;
      const again = yield* world.preparedTrees.reconcile();
      expect(again.retained).toEqual([]);
      expect(again.cleaned).toContain(record.id);
      const swept = yield* world.store.byId(record.id);
      expect(swept?.resourcesReleased).toBe(true);
      expect(swept?.cleanupReason).toBeNull();
    }),
  ),
);

it.live('an unreachable engine condemns no build', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const halfway = crypto.randomUUID();
      yield* world.store.open({ id: halfway, projectId: world.projectId, ownerId: OWNER, receipt: world.backend.receipt(halfway) });
      world.script.engineDown = true;
      expect(yield* world.preparedTrees.reconcile()).toEqual({
        engine: 'unreachable',
        checked: 1,
        cleaned: [],
        retained: [],
        released: [],
      });
      expect((yield* world.store.byId(halfway))?.state).toBe('building');
    }),
  ),
);

it.live('releasing an artifact removes its bytes and records a repeatable released outcome', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const record = yield* world.preparedTrees.build(RECIPE);
      const released = yield* world.preparedTrees.release(record.id);
      expect(released.state).toBe('released');
      expect(released.archivePath).toBeNull();
      expect(yield* world.files.exists(join(world.storageRoot, record.id))).toBe(false);
      expect((yield* world.preparedTrees.release(record.id)).state).toBe('released');
    }),
  ),
);

it.live('a project cannot seed from another project’s prepared tree', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const record = yield* world.preparedTrees.build(RECIPE);
      const owned = crypto.randomUUID();
      yield* world.store.open({ id: owned, projectId: world.projectId, ownerId: OWNER, receipt: world.backend.receipt(owned) });
      yield* world.store.sealed(owned, join(world.storageRoot, record.id, 'tree.tar'));
      yield* world.store.ready(owned, record.manifest!);
      const refused = yield* world.preparedTrees.acquire(owned, { ownerId: OWNER, projectId: world.projectId + 1 }).pipe(Effect.flip);
      expect(refused.message).toContain(`built for project ${world.projectId}`);
    }),
  ),
);
