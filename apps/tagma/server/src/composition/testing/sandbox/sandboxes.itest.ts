import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { basename, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Queue, Result, Stream } from 'effect';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import type { ThreadBirthCarried, ThreadRow } from '@runlith/agent/thread/rows';
import type { LiveGuest } from '../../../executions/contract/service/guests.js';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import type { SandboxManifest, GuestReceipt as Receipt } from '../../../sandbox/contract/wire/sandbox.js';
import type { PreparationReceipt, PreparedTreeManifest } from '../../../sandbox/contract/wire/preparedTree.js';
import { threadResourceStore, sandboxHolds, sandboxKind } from '../../../threads/testing/doubles.js';
import { threadStore } from '../../../native-harness/testing/doubles.js';
import type { GuestBackend, PreparationBackend } from '../../../sandbox/contract/service/backends.js';
import { PreparedTrees } from '../../../sandbox/contract/service/preparedTrees.js';
import { Sandboxes, SandboxUnavailable } from '../../../sandbox/contract/service/sandboxes.js';
import { SandboxFiles } from '../../../sandbox/contract/service/files.js';
import { SandboxHolds } from '../../../sandbox/contract/service/holds.js';
import { preparedTreeStore, preparedTreesService, sandboxStore, sandboxServices, liveGuests } from '../../../sandbox/testing/doubles.js';
import { ENTRY_KINDS } from '../../manifest.js';

const OWNER = 'operator';
const IMAGE = { reference: 'guest:abc', digest: 'sha256:abc', revision: 'abc' };
const LIMITS = { pids: 128, memory: '512m', cpus: '1' };
type StandingGuest = { readonly receipt: Receipt; status: 'running' | 'stopped' };
class GuestScript {
  readonly guests = new Map<string, StandingGuest>();
  removeFails = 0;
  exportFails = 0;
  exportText = 'a sealed tree';
  buildUnavailable = false;
  mismatch: string | null = null;
  opening: Deferred.Deferred<void> | null = null;
  exportGate: Deferred.Deferred<void> | null = null;
}
const makeBackend = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const script = new GuestScript();
  const opened = yield* Queue.unbounded<Receipt>();
  const exporting = yield* Queue.unbounded<string>();
  const receipt = (sandbox: string): Receipt => ({ backend: 'docker', container: `g-${sandbox}`, volume: `g-${sandbox}` });
  const backend: GuestBackend = {
    backend: 'docker',
    receipt,
    identity: () =>
      script.buildUnavailable
        ? Effect.fail(new SandboxUnavailable({ sandbox: 'image', reason: 'this installation carries no build context' }))
        : Effect.succeed({ image: IMAGE, platform: 'linux/arm64' }),
    create: (at) =>
      Effect.sync(() => {
        script.guests.set(at.container, { receipt: at, status: 'running' });
      }),
    unpack: () => Effect.void,
    run: () => Effect.succeed({ code: 0, output: '' }),
    stop: (at) =>
      Effect.sync(() => {
        const guest = script.guests.get(at.container);
        if (guest !== undefined) guest.status = 'stopped';
      }),
    inspect: (at) =>
      Effect.sync(() => {
        const guest = script.guests.get(at.container);
        return guest === undefined
          ? { status: 'gone' as const, image: null, mismatch: null }
          : { status: guest.status, image: IMAGE.digest, mismatch: script.mismatch };
      }),
    start: Effect.fnUntraced(function* (at) {
      const guest = script.guests.get(at.container);
      if (guest === undefined) return yield* new SandboxUnavailable({ sandbox: at.container, reason: 'the guest is gone' });
      guest.status = 'running';
    }),
    world: () => Effect.die('this suite opens no live world'),
    sealedWorld: Effect.fnUntraced(function* (at) {
      yield* Queue.offer(opened, at);
      const gate = script.opening;
      if (gate !== null) yield* Deferred.await(gate);
      return yield* new SandboxUnavailable({ sandbox: at.container, reason: 'this suite opens no tree' });
    }),
    export: Effect.fnUntraced(function* (at, into) {
      yield* Queue.offer(exporting, into);
      const gate = script.exportGate;
      if (gate !== null) yield* Deferred.await(gate);
      if (script.exportFails > 0) {
        script.exportFails -= 1;
        yield* files
          .writeFileString(into, 'half of a sealed tree')
          .pipe(Effect.mapError((error) => new SandboxUnavailable({ sandbox: at.container, reason: error.message })));
        return yield* new SandboxUnavailable({ sandbox: at.container, reason: 'export refused by the script' });
      }
      yield* files
        .writeFileString(into, script.exportText)
        .pipe(Effect.mapError((error) => new SandboxUnavailable({ sandbox: at.container, reason: error.message })));
    }),
    remove: Effect.fnUntraced(function* (at) {
      if (script.removeFails > 0) {
        script.removeFails -= 1;
        return yield* new SandboxUnavailable({ sandbox: at.container, reason: 'remove refused by the script' });
      }
      script.guests.delete(at.container);
    }),
    receipts: () => Effect.sync(() => [...script.guests.values()].map((guest) => guest.receipt)),
  };
  return { script, backend, opened: Queue.take(opened), exporting: Queue.take(exporting) };
});
const unused = () => Effect.die('no builder runs in this suite');
const preparation: PreparationBackend = {
  backend: 'docker',
  receipt: (build: string): PreparationReceipt => ({
    backend: 'docker',
    container: `b-${build}`,
    volume: `b-${build}`,
    network: null,
    proxy: null,
    check: `b-${build}-check`,
  }),
  target: unused,
  open: unused,
  unpack: unused,
  run: unused,
  revoke: unused,
  seal: unused,
  check: unused,
  close: () => Effect.void,
  receipts: () => Effect.succeed([]),
};
const makeCase = Effect.gen(function* () {
  const platform = yield* Layer.build(BunFileSystem.layer);
  const fs = Context.get(platform, FileSystem.FileSystem);
  const machine = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, yield* sharedPool))),
    ),
  );
  const context = Context.merge(platform, machine);
  const exportsRoot = yield* fs.makeTempDirectoryScoped({ prefix: 'tagma-sandbox-test-' });
  const { db } = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const threads = yield* Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)).pipe(Effect.provide(context));
  const store = yield* sandboxStore().pipe(Effect.provide(context));
  const ledger = yield* threadResourceStore().pipe(Effect.provide(context));
  const { script, backend, opened, exporting } = yield* makeBackend.pipe(Effect.provide(context));
  const artifacts = yield* preparedTreeStore().pipe(Effect.provide(context));
  const preparedTrees = preparedTreesService({
    store: artifacts,
    preparation,
    checkoutOf: () => Effect.succeed('/nowhere'),
    storageRoot: join(exportsRoot, 'artifacts'),
  });
  const owners = yield* sandboxServices({ store, runtime: backend, checkoutOf: () => Effect.succeed('/nowhere'), exportsRoot }).pipe(
    Effect.provideService(PreparedTrees, preparedTrees),
    Effect.provideService(SandboxHolds, sandboxHolds(ledger)),
    Effect.provide(context),
  );
  const sandboxes = Context.get(owners, Sandboxes);
  const files = Context.get(owners, SandboxFiles);
  const makeProject = Effect.fnUntraced(function* (name: string) {
    const row = yield* db
      .insert(project())
      .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt: new Date(yield* Clock.currentTimeMillis) })
      .returning({ id: project().id })
      .get();
    if (row === undefined) return yield* Effect.die('the sandbox fixture project was not inserted');
    return row.id;
  });
  const projectId = yield* makeProject('sandboxes');
  const otherProjectId = yield* makeProject('neighbour');
  const stamp = new Date(yield* Clock.currentTimeMillis).toISOString();
  const manifest = (source: SandboxManifest['source']): SandboxManifest => ({
    source,
    snapshotDigest: 'a'.repeat(64),
    exclusions: [':(exclude).git'],
    image: IMAGE,
    platform: 'linux/arm64',
    dependencyDigest: 'b'.repeat(64),
    dependencies: [],
    setup: [],
    limits: LIMITS,
    preparedAt: stamp,
  });
  const artifactManifest = (): PreparedTreeManifest => ({
    source: { kind: 'project', projectId, commit: 'a'.repeat(40) },
    snapshotDigest: 'c'.repeat(64),
    exclusions: [':(exclude).git'],
    image: IMAGE,
    platform: 'linux/arm64',
    network: { kind: 'none' },
    setup: [['/bin/sh', '-c', 'bun install']],
    readiness: [],
    readinessResults: [],
    dependencies: ['bun.lock'],
    dependencyDigest: 'd'.repeat(64),
    limits: LIMITS,
    archiveDigest: 'e'.repeat(64),
    archiveBytes: 4096,
    builtAt: stamp,
  });
  const readyArtifact = Effect.fnUntraced(function* (owner = OWNER, forProject: number | null = projectId) {
    const id = crypto.randomUUID();
    yield* artifacts.open({ id, projectId: forProject, ownerId: owner, receipt: preparation.receipt(id) });
    const home = join(exportsRoot, 'artifacts', id);
    yield* fs.makeDirectory(home, { recursive: true });
    yield* fs.writeFileString(join(home, 'tree.tar'), 'sealed bytes');
    yield* artifacts.sealed(id, join(home, 'tree.tar'));
    yield* artifacts.ready(id, artifactManifest());
    return id;
  });
  const makeThread = Effect.fnUntraced(function* (ownerId = OWNER) {
    const row = yield* threads.insert({ ownerId, agentId: 'any-agent' });
    yield* scopeRecord(db, row.id, { projectId });
    return row;
  });
  const openPrepared = Effect.fnUntraced(function* (owner = OWNER, forProject: number | null = projectId) {
    const id = crypto.randomUUID();
    const receipt = backend.receipt(id);
    yield* store.open({ id, projectId: forProject, ownerId: owner, runtime: receipt });
    script.guests.set(receipt.container, { receipt, status: 'stopped' });
    yield* store.prepared(
      id,
      manifest(forProject === null ? { kind: 'empty' } : { kind: 'project', projectId: forProject, commit: 'f'.repeat(40) }),
    );
    return id;
  });
  const admit = (sandbox: string, child: ThreadRow, carried: ThreadBirthCarried = 'fresh') =>
    units.write('Sandboxes.admit', (tx) => sandboxes.admit({ host: { kind: 'sandbox', id: sandbox }, child, projectId, carried }, tx));
  return {
    context,
    fs,
    exportsRoot,
    units,
    sandboxes,
    files,
    preparedTrees,
    artifacts,
    store,
    ledger,
    projectId,
    otherProjectId,
    script,
    backend,
    opened,
    exporting,
    readyArtifact,
    makeThread,
    openPrepared,
    admit,
  };
});
type Case = Effect.Success<typeof makeCase>;
const withCase = <A, E, R>(body: (world: Case) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(makeCase, (world) => Effect.provide(body(world), world.context));

it.live('racing births bind one thread and identify the loser’s holder', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const first = yield* world.makeThread();
      const second = yield* world.makeThread();
      const outcomes = yield* Effect.all(
        [world.admit(sandbox, first).pipe(Effect.result), world.admit(sandbox, second).pipe(Effect.result)],
        { concurrency: 2 },
      );
      expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
      expect(outcomes.find(Result.isFailure)?.failure.message).toContain('sandbox-taken');
      const winner = (yield* world.store.byId(sandbox))?.boundThreadId ?? '';
      expect([first.id, second.id]).toContain(winner);
      expect((yield* world.ledger.held([winner])).map((held) => held.kind)).toEqual(['sandbox']);
      expect(yield* world.ledger.held([winner === first.id ? second.id : first.id])).toEqual([]);
    }),
  ),
);

it.live('live guests follow the project’s births and endings', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const child = yield* world.makeThread();
      const seen = yield* Queue.unbounded<readonly LiveGuest[]>();
      yield* Effect.forkScoped(Stream.runForEach(liveGuests(world.store).follow(world.projectId), (guests) => Queue.offer(seen, guests)));
      const before = yield* Queue.take(seen);
      yield* world.admit(sandbox, child);
      const bound = yield* Queue.take(seen);
      yield* world.units.write('Sandboxes', (tx) => world.sandboxes.discard(sandbox, tx));
      expect([before, bound, yield* Queue.take(seen)].map((guests) => guests.map(({ guest, thread }) => [guest, thread]))).toEqual([
        [],
        [[sandbox, child.id]],
        [],
      ]);
    }),
  ),
);

it.live('readmitting the holder keeps one resource hold', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const child = yield* world.makeThread();
      yield* world.admit(sandbox, child);
      yield* world.admit(sandbox, child);
      expect(yield* world.ledger.held([child.id])).toHaveLength(1);
      expect((yield* world.store.byId(sandbox))?.boundThreadId).toBe(child.id);
    }),
  ),
);

it.live('an empty source admits any project while a project snapshot admits only its project', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const child = yield* world.makeThread();
      const empty = yield* world.openPrepared(OWNER, null);
      yield* world.admit(empty, child);
      expect((yield* world.store.byId(empty))?.boundThreadId).toBe(child.id);
      const other = yield* world.makeThread();
      const foreign = yield* world.openPrepared(OWNER, world.otherProjectId);
      expect((yield* world.admit(foreign, other).pipe(Effect.flip)).message).toContain(`prepared for project ${world.otherProjectId}`);
    }),
  ),
);

it.live('absent, preparing, foreign-owner, failed and forked-into sandboxes refuse admission without partial binding', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const child = yield* world.makeThread();
      expect((yield* world.admit('nothing-by-that-name', child).pipe(Effect.flip)).message).toContain('sandbox-unavailable');
      const preparing = crypto.randomUUID();
      yield* world.store.open({ id: preparing, projectId: world.projectId, ownerId: OWNER, runtime: world.backend.receipt(preparing) });
      expect((yield* world.admit(preparing, child).pipe(Effect.flip)).message).toContain('its preparation is preparing');
      const elsewhere = yield* world.openPrepared('another-operator');
      expect((yield* world.admit(elsewhere, child).pipe(Effect.flip)).message).toContain('another owner');
      const failed = yield* world.openPrepared();
      yield* world.store.failed(failed, 'its snapshot could not be exported');
      expect((yield* world.admit(failed, child).pipe(Effect.flip)).message).toContain('its snapshot could not be exported');
      expect((yield* world.store.byId(failed))?.boundThreadId).toBeNull();
      expect((yield* world.admit(yield* world.openPrepared(), child, 'all').pipe(Effect.flip)).message).toContain('starts fresh');
    }),
  ),
);

it.live('an unsupported host kind is refused', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const child = yield* world.makeThread();
      const refused = yield* world.units
        .write('Sandboxes.refusal', (tx) =>
          world.sandboxes.admit({ host: { kind: 'device', id: 'usb-0' }, child, projectId: world.projectId, carried: 'fresh' }, tx),
        )
        .pipe(Effect.flip);
      expect(refused.message).toContain('host-unknown');
    }),
  ),
);

it.live('a thread with no binding receives a typed acquisition refusal', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const refused = yield* world.sandboxes.acquire(yield* world.makeThread()).pipe(Effect.flip);
      expect(refused._tag).toBe('SandboxUnavailable');
      expect(refused.message).toContain('bound to no sandbox');
    }),
  ),
);

it.live('retrying a post-export removal failure preserves the original sealed bytes', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const receipt = world.backend.receipt(sandbox);
      world.script.removeFails = 1;
      expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip))._tag).toBe('SandboxUnavailable');
      const midway = yield* world.store.byId(sandbox);
      expect(midway?.state).toBe('releasing');
      const archive = midway?.exportPath;
      if (archive == null) return yield* Effect.die('the releasing sandbox kept no archive');
      expect(yield* world.fs.readFileString(archive)).toBe('a sealed tree');
      expect((yield* world.backend.inspect(receipt)).status).toBe('stopped');
      world.script.exportText = 'a later guest tree';
      const resumed = yield* world.sandboxes.release(sandbox);
      expect(resumed.path).toBe(archive);
      expect(yield* world.fs.readFileString(resumed.path)).toBe('a sealed tree');
      expect((yield* world.backend.inspect(receipt)).status).toBe('gone');
      expect((yield* world.store.byId(sandbox))?.state).toBe('released');
      expect((yield* world.sandboxes.release(sandbox)).path).toBe(archive);
    }),
  ),
);

it.effect('retrying a failed export leaves only the completed archive even while time is frozen', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      world.script.exportFails = 1;
      expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip))._tag).toBe('SandboxUnavailable');
      expect(yield* world.fs.readDirectory(join(world.exportsRoot, sandbox))).toEqual([]);
      const resumed = yield* world.sandboxes.release(sandbox);
      expect(yield* world.fs.readDirectory(join(world.exportsRoot, sandbox))).toEqual([basename(resumed.path)]);
      expect(yield* world.fs.readFileString(resumed.path)).toBe('a sealed tree');
    }),
  ),
);

it.live('an overlapping release is refused while the first owns the archive and guest removal', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const gate = yield* Deferred.make<void>();
      world.script.exportGate = gate;
      yield* Effect.gen(function* () {
        const first = yield* Effect.forkChild(world.sandboxes.release(sandbox));
        yield* world.exporting;
        expect(yield* world.sandboxes.cleanup([sandbox])).toEqual([]);
        expect((yield* world.store.byId(sandbox))?.failureReason).toBeNull();
        expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip)).message).toContain('sandbox-busy');
        expect((yield* world.store.byId(sandbox))?.failureReason).toBeNull();
        yield* Deferred.succeed(gate, undefined);
        const released = yield* Fiber.join(first);
        const row = yield* world.store.byId(sandbox);
        expect(row?.state).toBe('released');
        expect(row?.exportPath).toBe(released.path);
        expect(yield* world.fs.readDirectory(join(world.exportsRoot, sandbox))).toEqual([basename(released.path)]);
        expect(yield* world.fs.readFileString(released.path)).toBe('a sealed tree');
        expect((yield* world.backend.inspect(world.backend.receipt(sandbox))).status).toBe('gone');
      }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined)));
    }),
  ),
);

it.live('a holder blocks release until its ending records intent and cleanup removes the guest', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const child = yield* world.makeThread();
      yield* world.admit(sandbox, child);
      expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip)).message).toContain('sandbox-busy');
      const held = (yield* world.ledger.held([child.id]))[0]!;
      yield* world.units.write('Sandboxes', (tx) => sandboxKind(world.sandboxes).end!([held], tx));
      expect((yield* world.store.byId(sandbox))?.state).toBe('releasing');
      expect((yield* world.backend.inspect(world.backend.receipt(sandbox))).status).toBe('stopped');
      expect(yield* world.sandboxes.cleanup()).toEqual([sandbox]);
      expect((yield* world.backend.inspect(world.backend.receipt(sandbox))).status).toBe('gone');
      expect((yield* world.store.byId(sandbox))?.state).toBe('released');
    }),
  ),
);

it.live('boot condemns unfinished and vanished guests, sweeps marked orphans and preserves standing sandboxes', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const halfway = crypto.randomUUID();
      const halfReceipt = world.backend.receipt(halfway);
      yield* world.store.open({ id: halfway, projectId: world.projectId, ownerId: OWNER, runtime: halfReceipt });
      world.script.guests.set(halfReceipt.container, { receipt: halfReceipt, status: 'running' });
      const vanished = yield* world.openPrepared();
      world.script.guests.delete(world.backend.receipt(vanished).container);
      const orphan = world.backend.receipt('orphan');
      world.script.guests.set(orphan.container, { receipt: orphan, status: 'stopped' });
      const standing = yield* world.openPrepared();
      expect(yield* world.sandboxes.condemnUnfinished()).toEqual([halfway]);
      const reconciled = yield* world.sandboxes.reconcile();
      const released = yield* world.sandboxes.cleanup();
      expect(reconciled.engine).toBe('read');
      expect(reconciled.failed).toEqual([vanished]);
      expect(reconciled.removed).toContain(orphan.container);
      expect([...released].sort()).toEqual([halfway, vanished].sort());
      expect((yield* world.backend.inspect(orphan)).status).toBe('gone');
      expect((yield* world.backend.inspect(halfReceipt)).status).toBe('gone');
      expect((yield* world.store.byId(halfway))?.failureReason).toContain('did not finish');
      expect((yield* world.store.byId(standing))?.state).toBe('prepared');
      expect((yield* world.backend.inspect(world.backend.receipt(standing))).status).toBe('stopped');
    }),
  ),
);

it.live('a sandbox copied from an artifact carries its image and sealed digest', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const artifact = yield* world.readyArtifact();
      const record = yield* world.sandboxes.prepare({
        ownerId: OWNER,
        source: { kind: 'prepared', preparedTree: artifact },
        limits: LIMITS,
      });
      expect(record.state).toBe('prepared');
      expect(record.projectId).toBe(world.projectId);
      expect(record.manifest?.source).toEqual({ kind: 'prepared', preparedTree: artifact });
      expect(record.manifest?.image).toEqual(IMAGE);
      expect(record.manifest?.snapshotDigest).toBe('e'.repeat(64));
      expect((yield* world.backend.inspect(record.runtime)).status).toBe('stopped');
    }),
  ),
);

it.live('another owner’s artifact is refused and the sandbox records the failure', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const foreign = yield* world.readyArtifact('another-operator');
      const refused = yield* world.sandboxes
        .prepare({ ownerId: OWNER, source: { kind: 'prepared', preparedTree: foreign }, limits: LIMITS })
        .pipe(Effect.flip);
      expect(refused.message).toContain('another owner');
      expect((yield* world.store.standing()).find((row) => row.state === 'failed')?.failureReason).toContain('another owner');
    }),
  ),
);

it.live('an artifact held by a copy records release intent and admits no later copy', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const artifact = yield* world.readyArtifact();
      const held = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* world.preparedTrees.acquire(artifact, { ownerId: OWNER, projectId: world.projectId });
          return yield* world.preparedTrees.release(artifact).pipe(Effect.flip);
        }),
      );
      expect(held.message).toContain('prepared-tree-busy');
      expect((yield* world.artifacts.byId(artifact))?.state).toBe('releasing');
      expect(
        (yield* world.preparedTrees.acquire(artifact, { ownerId: OWNER, projectId: world.projectId }).pipe(Effect.flip)).message,
      ).toContain('it is releasing');
    }),
  ),
);

it.live('a read blocks birth without partial binding and releases the hold on failure', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const child = yield* world.makeThread();
      const gate = yield* Deferred.make<void>();
      world.script.opening = gate;
      yield* Effect.gen(function* () {
        const reading = yield* Effect.forkChild(
          Effect.scoped(world.files.read(sandbox, 'made.txt', { ownerId: OWNER, projectId: world.projectId })).pipe(Effect.result),
        );
        yield* world.opened;
        expect((yield* world.admit(sandbox, child).pipe(Effect.flip)).message).toContain('sandbox-reading');
        expect((yield* world.store.byId(sandbox))?.boundThreadId).toBeNull();
        yield* Deferred.succeed(gate, undefined);
        const outcome = yield* Fiber.join(reading);
        expect(outcome._tag).toBe('Failure');
        yield* world.admit(sandbox, child);
        expect((yield* world.store.byId(sandbox))?.boundThreadId).toBe(child.id);
      }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined)));
    }),
  ),
);

it.live('a reader prevents release while preserving the release intent', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const gate = yield* Deferred.make<void>();
      world.script.opening = gate;
      yield* Effect.gen(function* () {
        const reading = yield* Effect.forkChild(
          Effect.scoped(world.files.read(sandbox, 'made.txt', { ownerId: OWNER, projectId: world.projectId })).pipe(Effect.result),
        );
        yield* world.opened;
        expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip)).message).toContain('sandbox-reading');
        expect((yield* world.store.byId(sandbox))?.state).toBe('releasing');
        yield* Deferred.succeed(gate, undefined);
        expect((yield* Fiber.join(reading))._tag).toBe('Failure');
      }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined)));
    }),
  ),
);

it.live('reading a bound workload requires holding its session quiet and releases a refused admission hold', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const sandbox = yield* world.openPrepared();
      const child = yield* world.makeThread();
      yield* world.admit(sandbox, child);
      const alone = yield* Effect.scoped(world.files.read(sandbox, 'made.txt', { ownerId: OWNER, projectId: world.projectId })).pipe(
        Effect.flip,
      );
      expect(alone.message).toContain('cannot hold that session still');
      expect((yield* world.backend.inspect(world.backend.receipt(sandbox))).status).toBe('stopped');
      const holds = makeLandingHolds();
      const refused = yield* Effect.scoped(
        world.files.read(sandbox, 'made.txt', { ownerId: OWNER, projectId: world.projectId }, (threadId) =>
          Effect.acquireRelease(
            Effect.sync(() => holds.hold([threadId])),
            (release) => Effect.sync(release),
          ).pipe(Effect.as({ quiet: false, reason: `thread ${child.id} is taking a turn` })),
        ),
      ).pipe(Effect.flip);
      expect(refused.message).toContain('is taking a turn');
      expect(holds.admits(child.id)).toBe(true);
      expect((yield* world.sandboxes.release(sandbox).pipe(Effect.flip)).message).toContain('sandbox-busy');
    }),
  ),
);

it.live('an installed artifact admits a workload even when the installation cannot build another image', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const artifact = yield* world.readyArtifact();
      world.script.buildUnavailable = true;
      const prepared = yield* world.sandboxes.prepare({
        ownerId: OWNER,
        source: { kind: 'prepared', preparedTree: artifact },
        limits: LIMITS,
      });
      const child = yield* world.makeThread();
      yield* world.admit(prepared.id, child);
      const bound: ThreadRow = { ...child, hostKind: 'sandbox', hostId: prepared.id };
      expect((yield* world.sandboxes.acquire(bound)).manifest?.image).toEqual(IMAGE);
      expect((yield* world.backend.inspect(prepared.runtime)).status).toBe('running');
      world.script.mismatch = 'network is not isolated';
      expect((yield* world.sandboxes.acquire(bound).pipe(Effect.flip)).message).toContain('network is not isolated');
    }),
  ),
);

it.live('scoped deletion cleanup preserves unrelated intent and retries its own failed removal', () =>
  withCase((world) =>
    Effect.gen(function* () {
      const related = yield* world.openPrepared();
      const unrelated = yield* world.openPrepared();
      yield* world.store.releasing(related);
      yield* world.store.releasing(unrelated);
      expect(yield* world.sandboxes.cleanup([])).toEqual([]);
      expect((yield* world.store.byId(unrelated))?.state).toBe('releasing');
      world.script.removeFails = 1;
      expect(yield* world.sandboxes.cleanup([related])).toEqual([]);
      expect((yield* world.store.byId(related))?.state).toBe('releasing');
      expect((yield* world.store.byId(related))?.failureReason).toContain('remove refused');
      expect(yield* world.sandboxes.cleanup([related])).toEqual([related]);
      expect((yield* world.store.byId(related))?.state).toBe('released');
      expect((yield* world.store.byId(unrelated))?.state).toBe('releasing');
      expect((yield* world.backend.inspect(world.backend.receipt(unrelated))).status).toBe('stopped');
    }),
  ),
);

it.live('reconciling a machine with no sandbox reports an unasked engine', () =>
  withCase((world) =>
    Effect.gen(function* () {
      expect(yield* world.sandboxes.reconcile()).toEqual({ engine: 'unasked', checked: 0, failed: [], removed: [] });
    }),
  ),
);
