import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { World } from '@runlith/agent-tools/world';
import type { ActiveTarget } from '../../threads/contract/service/targetSnapshots.js';
import type { TargetSnapshot } from '../../threads/contract/wire/target.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import type { ThreadWorld } from '../../executions/contract/service/worlds.js';
import { standingOf, type ThreadPlaces } from './standing.js';

const thread = { id: 't1', ownerId: 'owner', projectId: 7, root: '/repo' };

const target = (runId: string, generation: number, workingRoot: string): TargetSnapshot => ({
  work: { projectId: 7, threadId: 't1' },
  runId,
  generation: WorkspaceGeneration.make(generation),
  sourceKey: 'root:w1',
  workingRoot,
  place: null,
  graph: { projectId: 7, root: '/repo' },
  admittedAt: '2026-01-01T00:00:00.000Z',
});

const worldAt = (root: string): ThreadWorld => ({
  kind: 'sandbox',
  facts: { shared: false, history: true, network: true },
  world: { root } as unknown as World,
  root,
  scratch: '/scratch',
  alive: () => true,
});

const rig = (active: ActiveTarget, standing: TargetSnapshot) => {
  const asked: string[] = [];
  const key = (at: TargetAt) => `${at.runId}@${at.generation}`;
  const places = {
    units: { read: (work: (unit: never) => unknown) => work(undefined as never) },
    snapshots: { readActive: () => Effect.succeed(active) },
    targets: {
      of: (
        _thread: unknown,
        use: { runId: string | null },
        acquire: (request: { at: TargetAt; root: string }) => Effect.Effect<{ world: ThreadWorld }>,
      ) =>
        Effect.map(
          acquire({ at: { threadId: 't1', runId: use.runId ?? 't1', generation: standing.generation }, root: standing.workingRoot }),
          (acquired) => ({ target: standing, world: acquired.world }),
        ),
    },
    worlds: {
      of: (request: { at: TargetAt; root: string }) =>
        Effect.sync(() => {
          asked.push(`of ${key(request.at)} ${request.root}`);
          return { world: worldAt(request.root), place: null };
        }),
      lease: () => Effect.die('a call only reads the standing world'),
      release: () => Effect.die('a call never closes a standing world'),
    },
    threads: {
      find: () => Effect.succeed({ id: 't1', hostKind: 'sandbox', hostId: 's1', authority: { mode: 'trust', bypassFrom: null } }),
    },
  } as unknown as ThreadPlaces;
  return { asked, stand: standingOf(places) };
};

it.effect("a thread with a live run stands in that run's world and working root, and the run names the call", () =>
  Effect.gen(function* () {
    const running = target('run-1', 2, '/worktrees/w1');
    const { asked, stand } = rig({ state: 'admitted', target: running }, running);
    const stood = yield* stand(thread);
    expect(stood.place.root).toBe('/worktrees/w1');
    expect(stood.standing.world.root).toBe('/worktrees/w1');
    expect(stood.standing.runId).toBe('run-1');
    expect(asked).toEqual(['of run-1@2 /worktrees/w1']);
  }),
);

it.effect(
  'a thread with no run stands in the world its placement opens, keyed by the thread, and the call neither leases nor closes it',
  () =>
    Effect.gen(function* () {
      const placed = target('t1', 0, '/worktrees/w2');
      const { asked, stand } = rig({ state: 'unavailable', reason: 'no-run' }, placed);
      const stood = yield* stand(thread);
      expect(stood.place.root).toBe('/worktrees/w2');
      expect(stood.standing.runId).toBeNull();
      expect(asked).toEqual(['of t1@0 /worktrees/w2']);
    }),
);

it.effect('a run whose target is not recorded yet still names the call', () =>
  Effect.gen(function* () {
    const placed = target('t1', 0, '/repo');
    const { stand } = rig({ state: 'unavailable', reason: 'no-target', runId: 'run-3', generation: WorkspaceGeneration.make(1) }, placed);
    expect((yield* stand(thread)).standing.runId).toBe('run-3');
  }),
);
