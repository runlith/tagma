import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { MachineUnits, unitOf } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { WorktreeRecords, type WorktreeRecord } from '../contract/service/worktrees.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import { makeUnbornWorktrees } from './unborn.js';

it.effect('a failed birth releases its unclaimed worktree, while a later thread placement keeps its worktree', () =>
  Effect.gen(function* () {
    const draft = (name: string): WorktreeRecord => ({
      rootId: RootId.make(name),
      projectId: 7,
      name,
      path: `/trees/${name}`,
      branch: `work/${name}`,
      baseBranch: 'main',
      baseCommit: 'a'.repeat(40),
      origin: name,
      hue: 0,
      setup: 'done',
      setupDetail: null,
      taskId: null,
      createdAt: new Date(0),
    });
    const orphan = draft('orphan');
    const taken = draft('taken');
    const records = new Map([orphan, taken].map((row) => [row.rootId, row]));
    const unit = unitOf<'machine'>({
      store: { path: 'memory', generation: 1 },
      run: () => Effect.die('unborn release does not issue SQL'),
    });
    const services = yield* Layer.build(
      Layer.mergeAll(
        Layer.mock(MachineUnits, { read: (work) => work(unit) }),
        Layer.mock(WorktreeRecords, { byRoot: (rootId) => Effect.sync(() => records.get(rootId) ?? null) }),
        Layer.mock(WorktreeThreads, {
          threadsMoved: () => () => {},
          stopping: () => () => {},
          placedIn: (_projectId, rootId) =>
            Effect.succeed(
              rootId === taken.rootId ? [{ threadId: 'thread', parentThreadId: null, createdAt: new Date(0), archivedAt: null }] : [],
            ),
        }),
        Layer.mock(WorktreeRetirement, {
          delete: (_projectId, rootId) =>
            Effect.sync(() => {
              const row = records.get(rootId)!;
              records.delete(rootId);
              return {
                rootId,
                name: row.name,
                committed: null,
                removed: true,
                threads: { moved: [], kept: [] },
                ended: [],
                branch: { status: 'deleted' as const, name: row.branch! },
              };
            }),
        }),
      ),
    );
    const unborn = yield* makeUnbornWorktrees({ settled: () => Effect.void }).pipe(Effect.provideContext(services));
    expect(yield* unborn.releasing(orphan.rootId)).toEqual({
      status: 'released',
      rootId: orphan.rootId,
      branch: { status: 'deleted', name: 'work/orphan' },
    });
    expect((yield* unborn.releasing(taken.rootId)).status).toBe('kept');
    expect(records.get(taken.rootId)).toEqual(taken);
    expect((yield* unborn.releasing(orphan.rootId)).status).toBe('kept');
  }),
);
