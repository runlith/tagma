import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { project } from '../../projects/store/table.js';
import { threadEntry, threadRun } from '../../threads/store/kernel.js';
import { bornThread } from '../testing/born.js';
import { MachineStore, type StoreDb, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import type { ProvedRoot } from '../../workspace/contract/wire/place.js';
import type { TargetSnapshot } from '../../threads/contract/wire/target.js';
import { makeTargetSnapshots } from './targetSnapshots.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));

const PLACE: ProvedRoot = {
  environment: {
    environmentId: 'host',
    kind: 'host',
    namespaceId: 'ns-1',
    identityWitness: { provider: 'test', format: 'v1', token: 'env' },
  },
  root: { namespaceId: 'ns-1', path: '/repo' },
  witness: { provider: 'test', format: 'v1', token: 'repo' },
  registration: null,
} as ProvedRoot;

const owned = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return { db, units, targets: yield* makeTargetSnapshots };
});

type Owned = Effect.Success<typeof owned>;

const registerProject = (db: StoreDb<'machine'>, name: string): Effect.Effect<number, StoreFailure> =>
  Effect.flatMap(
    db
      .insert(project)
      .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt: new Date() })
      .returning({ id: project.id })
      .get(),
    (row) => (row === undefined ? Effect.die(new Error('the test project was not registered')) : Effect.succeed(row.id)),
  );

const born = (db: StoreDb<'machine'>, id: string): Effect.Effect<void, StoreFailure> =>
  bornThread(db, {
    id,
    ownerId: 'operator',
    agentId: 'tagma',
    spawnRootId: id,
    cacheGroup: id,
    authority: {} as never,
  });

const running = (db: StoreDb<'machine'>, threadId: string, runId: string): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(db.insert(threadRun).values({ id: runId, threadId, ownerId: 'operator', status: 'running' }));

const published = (
  db: StoreDb<'machine'>,
  input: { threadId: string; runId: string; ord: number; generation: number; sourceKey: string },
): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(
    db.insert(threadEntry).values({
      threadId: input.threadId,
      ord: input.ord,
      entryId: `context-change:${input.runId}:req-${input.generation}`,
      runId: input.runId,
      type: 'context-change',
      entry: {
        type: 'context-change',
        id: `context-change:${input.runId}:req-${input.generation}`,
        runId: input.runId,
        requestId: `req-${input.generation}`,
        sourceKey: input.sourceKey,
        status: 'published',
        fromGeneration: input.generation - 1,
        generation: input.generation,
        occurredAt: new Date().toISOString(),
      } as never,
    }),
  );

const target = (input: {
  projectId: number;
  threadId: string;
  runId: string;
  generation: number;
  root: string;
  sourceKey?: string;
}): TargetSnapshot => ({
  work: { projectId: input.projectId, threadId: input.threadId },
  runId: input.runId,
  generation: WorkspaceGeneration.make(input.generation),
  sourceKey: input.sourceKey ?? 'intrinsic',
  workingRoot: input.root,
  place: PLACE,
  graph: { projectId: input.projectId, root: '/repo' },
  admittedAt: new Date().toISOString(),
});

const record = (held: Owned, one: TargetSnapshot) =>
  held.units.write('TargetSnapshotStore.record', (unit) => held.targets.record(one, unit));

it.live('a recorded target is immutable: a second record of one generation keeps what stands', () =>
  Effect.gen(function* () {
    const held = yield* owned;
    const projectId = yield* registerProject(held.db, 'immutable');
    yield* born(held.db, 't1');
    yield* running(held.db, 't1', 'run-1');

    const first = yield* record(held, target({ projectId, threadId: 't1', runId: 'run-1', generation: 0, root: '/repo' }));
    expect(first.workingRoot).toBe('/repo');

    const again = yield* record(
      held,
      target({ projectId, threadId: 't1', runId: 'run-1', generation: 0, root: '/elsewhere', sourceKey: 'root:r9' }),
    );
    expect(again.workingRoot).toBe('/repo');
    expect(again.sourceKey).toBe('intrinsic');

    const read = yield* held.units.read((unit) =>
      held.targets.at({ threadId: 't1', runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit),
    );
    expect(read).toEqual(first);
    expect(read?.place).toEqual(PLACE);
    expect(read?.work).toEqual({ projectId, threadId: 't1' });
    expect(read?.graph).toEqual({ projectId, root: '/repo' });
  }).pipe(Effect.provide(storage)),
);

it.live('readActive follows the kernel\u2019s running run and its published generation, and answers unavailable rather than guessing', () =>
  Effect.gen(function* () {
    const held = yield* owned;
    const projectId = yield* registerProject(held.db, 'active');
    yield* born(held.db, 't1');

    expect(yield* held.units.read((unit) => held.targets.readActive('t1', unit))).toEqual({
      state: 'unavailable',
      reason: 'no-run',
    });

    yield* running(held.db, 't1', 'run-1');
    expect(yield* held.units.read((unit) => held.targets.readActive('t1', unit))).toEqual({
      state: 'unavailable',
      reason: 'no-target',
      runId: 'run-1',
      generation: WorkspaceGeneration.make(0),
    });

    const opening = yield* record(held, target({ projectId, threadId: 't1', runId: 'run-1', generation: 0, root: '/repo' }));
    expect(yield* held.units.read((unit) => held.targets.readActive('t1', unit))).toEqual({
      state: 'admitted',
      target: opening,
    });

    yield* published(held.db, { threadId: 't1', runId: 'run-1', ord: 1, generation: 1, sourceKey: 'root:r1' });
    expect(yield* held.units.read((unit) => held.targets.readActive('t1', unit))).toMatchObject({
      state: 'unavailable',
      reason: 'no-target',
      generation: 1,
    });

    const moved = yield* record(
      held,
      target({ projectId, threadId: 't1', runId: 'run-1', generation: 1, root: '/worktree', sourceKey: 'root:r1' }),
    );
    expect(yield* held.units.read((unit) => held.targets.readActive('t1', unit))).toEqual({
      state: 'admitted',
      target: moved,
    });
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId: 't1', runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit)),
    ).toEqual(opening);
  }).pipe(Effect.provide(storage)),
);
