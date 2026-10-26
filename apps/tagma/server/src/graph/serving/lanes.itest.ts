import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer, Queue } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import { GraphStore, MachineStore } from '../../platform/contract/service/store.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { shippedSteps } from '../steps/sequence.js';
import { syncTopology } from '../tree/topology.js';
import { Capacity, HEAVY, serverCapacity } from '../../platform/contract/service/capacity.js';
import { GraphSteps } from '../contract/service/steps.js';
import { ProjectPolicy } from '../contract/service/serving.js';
import { OPEN_FOR_CALL, OPENS } from '../contract/service/lanes.js';
import { capacity } from '@runlith/held/Capacity';
import { StallRecords } from '@runlith/held/holding';
import { machineGraphOf } from './machine.js';
import { graphPool } from '../testing/doubles.js';

const STEP = 'held-open';

const shippedTrees = Effect.fnUntraced(function* (
  machine: Parameters<typeof graphPool>[0]['machine'],
  demoRoot: string,
  projectId: number,
  trees: readonly string[],
) {
  const pool = yield* Effect.acquireRelease(
    graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
    (held) => held.dispose(),
  );
  const main = yield* pool.resolve({ projectId });
  if (main.shadow === null) return yield* Effect.die('opening lanes require a stealth graph');
  const row = (yield* Context.get(machine, ProjectPolicy).read([projectId])).get(projectId);
  if (row === undefined) return yield* Effect.die('the opening project is missing');
  for (const tree of trees) {
    const layout = yield* resolveStorageLayout({
      mode: 'stealth',
      projectId: row.id,
      ...storageHomes(Context.get(machine, MachineStore).path),
      worktree: tree,
    });
    yield* syncTopology(main.shadow, tree, layout.treeRoot, shippedSteps);
  }
}, Effect.scoped);

const heldOpens = Effect.fnUntraced(function* (context: Context.Context<GraphSteps>) {
  const entered = yield* Queue.unbounded<string>();
  const proceed = yield* Deferred.make<void>();
  const main = { mirror: '' };
  const standing = Context.get(context, GraphSteps);
  const steps = GraphSteps.of({
    ...standing,
    last: STEP,
    standing: (reached) => (reached === STEP ? 'current' : 'behind'),
    after: (reached) =>
      reached === STEP
        ? []
        : [
            ...standing.after(reached),
            {
              id: STEP,
              run: Effect.fnUntraced(function* () {
                const mirror = (yield* GraphStore).path;
                if (main.mirror === '' || mirror === main.mirror) return;
                yield* Queue.offer(entered, mirror);
                yield* Deferred.await(proceed);
              }),
            },
          ],
    lower: (one, other) => (one === STEP ? other : other === STEP ? one : standing.lower(one, other)),
  });
  yield* Effect.addFinalizer(() => Deferred.succeed(proceed, undefined));
  return { steps, entered, proceed, main };
});

layer(demoGraphLayer({ repos: ['alpha'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('opening lane', (it) => {
  it.effect('a worktree opening held in its format step leaves the main copy answering, and opens never outrun the lane', () =>
    withDemo(({ graph, context, project, demoRoot, fixture }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const alpha = project('alpha');
          yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'stealth' });
          const trees: string[] = [];
          for (const name of ['one', 'two', 'three']) {
            const tree = yield* fixture.directory(name);
            yield* runGit(graph.git, 'worktree', ['worktree', 'add', '-b', name, tree], { cwd: alpha.root });
            trees.push(tree);
          }
          yield* shippedTrees(machineGraphOf(context), demoRoot, alpha.id, trees);
          const { steps, entered, proceed, main } = yield* heldOpens(context);
          const capacity = serverCapacity([
            { name: HEAVY, units: 3, limits: { call: 2, background: 1 } },
            { name: OPENS, units: 2, limits: { call: 2, background: 1 } },
          ]);
          const machine = machineGraphOf(Context.add(context, Capacity, capacity));
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot, steps }),
            (held) => held.dispose(),
          );
          main.mirror = (yield* pool.resolve({ projectId: alpha.id })).layout.mirrorPath;
          const opens = yield* Effect.forEach(trees, (tree) => Effect.forkChild(pool.resolve({ projectId: alpha.id, cwd: tree })));
          const first = yield* Queue.take(entered);
          const second = yield* Queue.take(entered);
          expect(first).not.toBe(second);
          expect(capacity.standing().find((one) => one.pool === OPENS)).toMatchObject({ taken: { call: 2 }, queued: 1 });
          expect((yield* pool.resolve({ projectId: alpha.id })).layout.mirrorPath).toBe(main.mirror);
          expect(yield* Queue.size(entered)).toBe(0);
          const waiting = yield* Effect.forkChild(Effect.scoped(pool.hold({ projectId: alpha.id, cwd: trees[2]! })));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(waiting);
          yield* Deferred.succeed(proceed, undefined);
          const opened = yield* Effect.forEach(opens, Fiber.join);
          expect(new Set(opened.map((served) => served.layout.treeRoot)).size).toBe(3);
          expect(pool.held()).toHaveLength(4);
        }),
      ),
    ),
  );

  it.effect(
    'a storage move started while a copy opens waits for that open and closes it, and a resolve after the move began opens where the project then stands',
    () =>
      withDemo(({ graph, context, project, demoRoot }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const alpha = project('alpha');
            yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'stealth' });
            const { steps, entered, proceed, main } = yield* heldOpens(context);
            const pool = yield* Effect.acquireRelease(
              graphPool({
                migrations: fixtureGraphMigrations,
                identity: testSessionIdentity,
                machine: machineGraphOf(context),
                sourcePath: demoRoot,
                steps,
              }),
              (held) => held.dispose(),
            );
            main.mirror = 'every mirror';
            const opening = yield* Effect.forkChild(pool.resolve({ projectId: alpha.id }));
            yield* Queue.take(entered);
            main.mirror = '';
            const moving = yield* Effect.forkChild(pool.moveProjectStorage({ projectId: alpha.id, mode: 'team' }), {
              startImmediately: true,
            });
            const resolving = yield* Effect.forkChild(pool.resolve({ projectId: alpha.id }), { startImmediately: true });
            expect(moving.pollUnsafe()).toBeUndefined();
            expect(resolving.pollUnsafe()).toBeUndefined();
            expect((yield* graph.projectPolicy.read([alpha.id])).get(alpha.id)?.storage).toBe('stealth');
            yield* Deferred.succeed(proceed, undefined);
            const opened = yield* Fiber.join(opening);
            const moved = yield* Fiber.join(moving);
            expect(moved.row.storage).toBe('team');
            expect((yield* Fiber.join(resolving)).layout.treeRoot).toBe(moved.treeRoot);
            expect(pool.held().map((copy) => copy.treeRoot)).not.toContain(opened.layout.treeRoot);
          }),
        ),
      ),
  );

  it.effect(
    'a birth whose open the lane refuses lets the project go and leaves it open to the next act, and letting it go finishes under constant use',
    () =>
      withDemo(({ graph, context, project, demoRoot }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const alpha = project('alpha');
            yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'stealth' });
            const lanes = capacity(
              [
                { name: HEAVY, units: 1, limits: { call: 1, background: 1 } },
                { name: OPENS, units: 1, limits: { call: 1, background: 1 } },
              ],
              { admission: 0, queued: 0 },
            );
            const pool = yield* Effect.acquireRelease(
              graphPool({
                migrations: fixtureGraphMigrations,
                identity: testSessionIdentity,
                machine: machineGraphOf(Context.add(context, Capacity, lanes)),
                sourcePath: demoRoot,
              }),
              (held) => held.dispose(),
            );
            const taken = yield* lanes.tryLease(OPEN_FOR_CALL);
            const refused = yield* Effect.flip(pool.birth(alpha.id).pipe(Effect.provideService(StallRecords, () => Effect.void)));
            expect(refused.code).toBe('graph-pool');
            expect(pool.held()).toEqual([]);
            taken?.();
            const main = yield* pool.resolve({ projectId: alpha.id });
            expect(main.projectId).toBe(alpha.id);
            const entered = yield* Deferred.make<void>();
            const using = yield* Effect.forkChild(
              Effect.forever(
                Effect.andThen(
                  pool.resolve({ projectId: alpha.id }),
                  Effect.andThen(Deferred.succeed(entered, undefined), Effect.yieldNow),
                ),
              ),
            );
            yield* Deferred.await(entered);
            yield* pool.releaseProject(alpha.id);
            yield* Fiber.interrupt(using);
          }),
        ),
      ),
  );
});
