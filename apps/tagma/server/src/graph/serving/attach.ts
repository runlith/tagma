import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import {
  type MigrationChain,
  GraphStore,
  MachineStore,
  type StoreIdentity,
  type StoreOpenFailure,
} from '../../platform/contract/service/store.js';
import { type GraphUnits, MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { runGit } from '../../platform/git/ownGit.js';
import { mirrorStoreLayer } from '../storage/baseline.js';
import { session } from '../../platform/store/writers.js';
import type { FloorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { block, blockField, blockTag, edge, event, meta, ref, searchIndex, source, touch } from '../store/tables.js';
import { project } from '../../projects/store/table.js';
import { projectPolicy, writePolicy } from '../store/policy.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { blocksRetiredKey, FORMAT_FILE, rowsStepKey } from '../contract/wire/storage.js';
import { readMarker, writeMarker } from '../tree/marker.js';
import type { GraphServices } from '../contract/service/services.js';
import { Tags } from '../contract/service/vocabulary.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import type { GraphContext } from '../contract/service/serving.js';
import { projectToTree, syncProject } from '../tree/projection.js';
import { treeHeadStamp } from '../tree/stamp.js';
import { coverCommitJournals } from '../tree/message.js';
import { ShadowGit } from '../tree/shadow.js';
import type { BlockTreeUnreadable } from '../tree/layout.js';
import { treeHoldsAny } from '../tree/scan.js';
import { syncTopology } from '../tree/topology.js';
import { treeBranch } from '../tree/batch.js';
import type { GraphSteps } from '../contract/service/steps.js';
import { MIRROR_FILES, type StealthLayout, type StorageLayout } from '../storage/layout.js';

type Machine = Context.Context<GraphServices | GraphStore | GraphUnits | MachineStore | MachineUnits>;

export type RegistryStamp = { readonly identity: StoreIdentity; readonly revision: number };

const MOVED_KEY = 'moved-project';

const switchStarting = writes('switch.start', [meta]);

const switchRetiring = writes('switch.retire', [meta]);

const registrySyncing = writes('MirrorBuilder.syncRegistry', [project, projectPolicy]);

const switchStartedKey = (projectId: number): string => `switch-started:${projectId}`;

export const syncRegistry = Effect.fn('MirrorBuilder.syncRegistry')(function* (
  machine: Machine,
  synced: Map<string, RegistryStamp>,
  context: GraphContext,
) {
  const store = Context.get(context, GraphStore);
  const { db, path, identity } = store;
  const version = yield* Context.get(machine, Projects).registryVersion;
  const held = synced.get(path);
  let written = 0;
  if (held?.identity.generation === identity.generation && held.revision === version) {
    yield* Effect.annotateCurrentSpan({ written });
    return;
  }
  const machineDb = Context.get(machine, MachineStore).db;
  const standing = yield* Context.get(machine, MachineUnits).read((unit) =>
    unit.run(
      machineDb.select({ project, policy: projectPolicy }).from(project).leftJoin(projectPolicy, eq(projectPolicy.projectId, project.id)),
    ),
  );
  const registry = standing.map((row) => row.project);
  const policies = standing.flatMap((row) => (row.policy === null ? [] : [row.policy]));
  yield* store.transaction(registrySyncing, () =>
    Effect.gen(function* () {
      const held = new Map((yield* db.select().from(project)).map((item) => [item.id, item]));
      const named = new Set(registry.map((item) => item.id));
      for (const id of [...held.keys()]) {
        if (named.has(id)) continue;
        yield* db.delete(project).where(eq(project.id, id));
        written += 1;
        held.delete(id);
      }
      for (const item of registry) {
        const mine = held.get(item.id);
        if (mine === undefined) {
          yield* db.insert(project).values({ ...item });
          written += 1;
        } else if (JSON.stringify({ ...mine, createdAt: null }) !== JSON.stringify({ ...item, createdAt: null })) {
          yield* db
            .update(project)
            .set({ ...item })
            .where(eq(project.id, item.id));
          written += 1;
        }
      }
      const heldPolicies = new Map((yield* db.select().from(projectPolicy)).map((item) => [item.projectId, item]));
      for (const { projectId, ...fields } of policies) {
        const mine = heldPolicies.get(projectId);
        heldPolicies.delete(projectId);
        if (
          mine !== undefined &&
          mine.strictProvenance === fields.strictProvenance &&
          mine.private === fields.private &&
          mine.storage === fields.storage &&
          mine.graphRemote === fields.graphRemote
        )
          continue;
        yield* writePolicy(db, projectId, fields);
        written += 1;
      }
      for (const projectId of heldPolicies.keys()) {
        yield* db.delete(projectPolicy).where(eq(projectPolicy.projectId, projectId));
        written += 1;
      }
    }),
  );
  synced.set(path, { identity, revision: version });
  yield* Effect.annotateCurrentSpan({ written });
});

export function registrySynced(machine: Machine, synced: Map<string, RegistryStamp>, context: GraphContext): Effect.Effect<boolean> {
  const { path, identity } = Context.get(context, GraphStore);
  return Effect.map(Context.get(machine, Projects).registryVersion, (version) => {
    const held = synced.get(path);
    return held?.identity.generation === identity.generation && held.revision === version;
  });
}

export function forgetRegistry(synced: Map<string, RegistryStamp>, context: GraphContext): Effect.Effect<void> {
  return Effect.sync(() => {
    synced.delete(Context.get(context, GraphStore).path);
  });
}

const headOf = Effect.fnUntraced(function* (git: Git['Service'], treeRoot: string) {
  const read = yield* Effect.result(runGit(git, 'head', ['-C', treeRoot, 'rev-parse', 'HEAD']));
  if (read._tag === 'Success') return read.success;
  yield* Effect.logWarning('the head of the tree this store moved to could not be read, so its stamp is cleared', {
    tree: treeRoot,
    reason: read.failure.message,
  });
  return null;
});

export const travelMirror = Effect.fnUntraced(function* (
  git: Git['Service'],
  machine: MachineStore['Service'],
  migrations: MigrationChain<'graph'>,
  synced: Map<string, RegistryStamp>,
  from: string,
  to: string,
  treeRoot: string | null,
) {
  if (!existsSync(from)) return;
  const release = (path: string, reason: string) =>
    Effect.flatMap(Effect.orDie(migrations.snapshots?.release(path) ?? Effect.succeed([])), (released) =>
      Effect.sync(
        () =>
          released.length > 0 &&
          console.log(`[tagma] ${path}: the standing pre-migration snapshot ${released.join(', ')} is released because ${reason}`),
      ),
    );
  yield* release(to, `the store at ${from} replaces it`);
  synced.delete(from);
  synced.delete(to);
  mkdirSync(dirname(to), { recursive: true });
  for (const suffix of MIRROR_FILES) rmSync(`${to}${suffix}`, { recursive: true, force: true });
  yield* Effect.gen(function* () {
    const runtime = ManagedRuntime.make(mirrorStoreLayer(from, migrations).pipe(Layer.provide(Layer.succeed(MachineStore, machine))));
    yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
    const { db } = Context.get(yield* runtime.contextEffect, GraphStore);
    yield* db.run(sql`VACUUM INTO ${to}`);
  }).pipe(Effect.scoped, Effect.andThen(release(from, `the store moves to ${to}`)));
  for (const suffix of MIRROR_FILES) rmSync(`${from}${suffix}`, { recursive: true, force: true });
  const head = treeRoot === null ? null : yield* headOf(git, treeRoot);
  yield* Effect.gen(function* () {
    const runtime = ManagedRuntime.make(mirrorStoreLayer(to, migrations).pipe(Layer.provide(Layer.succeed(MachineStore, machine))));
    yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
    const store = Context.get(yield* runtime.contextEffect, GraphStore);
    const stamp = treeHeadStamp();
    yield* (head === null ? stamp.clearStamp : stamp.writeStamp(head)).pipe(Effect.provideService(GraphStore, store));
    yield* coverCommitJournals(store);
  }).pipe(Effect.scoped);
});

export const attachShadowTree = Effect.fnUntraced(function* (
  git: Git['Service'],
  row: ProjectPolicyRow,
  checkout: string,
  layout: StealthLayout,
  steps: GraphSteps['Service'],
) {
  const shadow = yield* ShadowGit.open(layout.gitDir, git, row.graphRemote);
  const repo = yield* treeBranch(checkout);
  if ('held' in repo && repo.held === 'no-repository') yield* shadow.attach(layout.treeRoot, 'main');
  else yield* syncTopology(shadow, checkout, layout.treeRoot, steps, { absorb: false });
  return shadow;
});

export const attachTree = Effect.fnUntraced(function* (
  git: Git['Service'],
  row: ProjectPolicyRow,
  checkout: string,
  layout: StorageLayout,
  steps: GraphSteps['Service'],
) {
  if (layout.mode === 'team') {
    mkdirSync(layout.treeRoot, { recursive: true });
    return { shadow: null, twinned: false };
  }
  return { shadow: yield* attachShadowTree(git, row, checkout, layout, steps), twinned: true };
});

export function treeHoldsBlocks(treeRoot: string): Effect.Effect<boolean, BlockTreeUnreadable> {
  if (!existsSync(treeRoot)) return Effect.succeed(false);
  return treeHoldsAny(treeRoot);
}

const mirrorHolds = Effect.fnUntraced(function* (
  machine: MachineStore['Service'],
  migrations: MigrationChain<'graph'>,
  mirrorPath: string,
  projectId: number,
) {
  const runtime = ManagedRuntime.make(mirrorStoreLayer(mirrorPath, migrations).pipe(Layer.provide(Layer.succeed(MachineStore, machine))));
  yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
  const { db } = Context.get(yield* runtime.contextEffect, GraphStore);
  const moved = yield* db.select({ value: meta.value }).from(meta).where(eq(meta.key, MOVED_KEY)).get();
  if (moved !== undefined) return moved.value === String(projectId) ? ('moved' as const) : ('other-project' as const);
  const any = yield* db.select({ projectId: block.projectId }).from(block).limit(1);
  if (any.length === 0) return 'nothing' as const;
  return any[0]?.projectId === projectId ? ('rows' as const) : ('other-project' as const);
}, Effect.scoped);

const moveProject = Effect.fn('MirrorBuilder.moveProject')(function* (
  machine: MachineStore['Service'],
  store: GraphStore['Service'],
  projectId: number,
  head: string | null,
) {
  const { db } = store;
  yield* db.run(sql`PRAGMA foreign_keys = OFF`);
  yield* db.run(sql`attach database ${machine.path} as machine`);
  const mine = sql`(select id from machine.block where project_id = ${projectId})`;
  yield* store.transaction(
    writes('mirror.move', [
      block,
      blockField,
      blockTag,
      edge,
      event,
      meta,
      project,
      projectPolicy,
      ref,
      searchIndex,
      session,
      source,
      touch,
    ]),
    () =>
      Effect.gen(function* () {
        yield* db.run(sql`insert into project select * from machine.project`);
        yield* db.run(sql`insert into project_policy select * from machine.project_policy`);
        yield* db.run(sql`insert into session select * from machine.session`);
        yield* db.run(sql`insert into block select * from machine.block where project_id = ${projectId}`);
        yield* db.run(
          sql`insert into block_tag (block_id, tag, type_id) select block_id, tag, type_id from machine.block_tag where block_id in ${mine}`,
        );
        yield* db.run(sql`insert into block_field select * from machine.block_field where block_id in ${mine}`);
        yield* db.run(sql`insert into source select * from machine.source where block_id in ${mine}`);
        yield* db.run(sql`insert into edge select * from machine.edge where from_id in ${mine} and to_id in ${mine}`);
        yield* db.run(sql`insert into ref select * from machine.ref where from_id in ${mine}`);
        yield* db.run(sql`insert into search_index select * from machine.search_index where block_id in ${mine}`);
        yield* db.run(sql`insert into touch select * from machine.touch where task_id in ${mine}`);
        yield* db.run(sql`insert into event select * from machine.event where project_id = ${projectId} or block_id in ${mine}`);
        if (head !== null) yield* treeHeadStamp().writeStamp(head).pipe(Effect.provideService(GraphStore, store));
        const dangling = yield* db.all(sql`PRAGMA main.foreign_key_check`);
        if (dangling.length > 0) {
          return yield* Effect.die(
            `the serving switch left ${dangling.length} dangling references: ${JSON.stringify(dangling.slice(0, 5))}`,
          );
        }
        yield* db.insert(meta).values({ key: MOVED_KEY, value: String(projectId) });
      }),
  );
  yield* db.run(sql`detach database machine`);
  yield* db.run(sql`PRAGMA foreign_keys = ON`);
});

export const switchIfDue = Effect.fnUntraced(function* (
  machine: Machine,
  git: Git['Service'],
  migrations: MigrationChain<'graph'>,
  row: ProjectPolicyRow,
  layout: StorageLayout,
  shadow: ShadowGit | null,
  rowsStep: string | null,
  openMirror: Effect.Effect<GraphStore['Service'], StoreOpenFailure>,
  treeHasBlocks?: boolean,
): Effect.fn.Return<'standing' | 'switched' | 'virgin', GateRefusal<FloorRefusal> | { readonly _tag: string; readonly message: string }> {
  const machineStore = Context.get(machine, MachineStore);
  const retiredKey = blocksRetiredKey(row.id);
  const startedKey = switchStartedKey(row.id);
  const stepKey = rowsStepKey(row.id);
  const retire = machineStore.transaction(switchRetiring, () =>
    Effect.gen(function* () {
      yield* machineStore.db
        .insert(meta)
        .values({ key: retiredKey, value: 'files' })
        .onConflictDoUpdate({ target: meta.key, set: { value: 'files' } });
      yield* machineStore.db.delete(meta).where(inArray(meta.key, [startedKey, stepKey]));
    }),
  );
  const standingMarks = yield* machineStore.db
    .select({ key: meta.key, value: meta.value })
    .from(meta)
    .where(inArray(meta.key, [retiredKey, startedKey, stepKey]));
  const marks = new Set(standingMarks.map((mark) => mark.key));
  const rowsAt = rowsStep ?? standingMarks.find((mark) => mark.key === stepKey)?.value ?? null;
  const retired = marks.has(retiredKey);
  const unretired = retired ? [] : yield* machineStore.db.select({ id: block.id }).from(block).where(eq(block.projectId, row.id)).limit(1);
  const due = unretired.length > 0;
  const holds = existsSync(layout.mirrorPath)
    ? yield* mirrorHolds(machineStore, migrations, layout.mirrorPath, row.id)
    : ('nothing' as const);
  if (holds === 'moved' || (holds === 'rows' && !due)) {
    if (!retired) yield* retire;
    return 'standing';
  }
  if (holds !== 'nothing') {
    for (const suffix of MIRROR_FILES) rmSync(`${layout.mirrorPath}${suffix}`, { recursive: true, force: true });
  }
  if (!due) return retired ? 'standing' : 'virgin';
  const resumed = marks.has(startedKey) || holds === 'rows';
  const treeStands = !resumed && (treeHasBlocks ?? (yield* treeHoldsBlocks(layout.treeRoot)));
  if (!treeStands) {
    yield* machineStore.transaction(switchStarting, () =>
      machineStore.db.insert(meta).values({ key: startedKey, value: 'started' }).onConflictDoNothing(),
    );
    const markerPath = join(layout.treeRoot, FORMAT_FILE);
    const marking =
      rowsAt === null
        ? Effect.void
        : Effect.flatMap(readMarker(markerPath), (standing) =>
            standing.kind === 'absent' ? writeMarker(markerPath, rowsAt) : Effect.void,
          );
    if (shadow !== null) yield* marking;
    const land =
      shadow === null
        ? Effect.as(projectToTree({ projectId: row.id, treeRoot: layout.treeRoot }), null)
        : Effect.map(
            syncProject({ projectId: row.id, treeRoot: layout.treeRoot, shadow, message: 'the serving switch' }),
            (synced) => synced.commit,
          );
    const committed = yield* land.pipe(
      Effect.provideService(GraphStore, Context.get(machine, GraphStore)),
      Effect.provideService(Tags, Context.get(machine, Tags)),
    );
    mkdirSync(dirname(layout.mirrorPath), { recursive: true });
    for (const suffix of MIRROR_FILES) rmSync(`${layout.mirrorPath}${suffix}`, { recursive: true, force: true });
    const read = committed === null ? yield* Effect.result(runGit(git, 'head', ['-C', layout.treeRoot, 'rev-parse', 'HEAD'])) : null;
    if (read?._tag === 'Failure') {
      yield* Effect.logWarning('the head of the tree the store moved to could not be read, so its stamp is cleared', {
        tree: layout.treeRoot,
        reason: read.failure.message,
      });
    }
    yield* moveProject(machineStore, yield* openMirror, row.id, committed ?? (read?._tag === 'Success' ? read.success : null));
    if (shadow === null) yield* marking;
  }
  yield* retire;
  return treeStands ? 'standing' : 'switched';
});
