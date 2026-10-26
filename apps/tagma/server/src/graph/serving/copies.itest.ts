import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Queue, type Scope } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import type { CopyEvent } from '../contract/service/serving.js';
import { CopyKeeping, type Keeping } from './copies.js';
import { machineGraphOf } from './machine.js';
import type { GraphPool } from './pool.js';
import { graphPool } from '../testing/doubles.js';

type Kept = {
  readonly pool: GraphPool;
  readonly events: Queue.Queue<CopyEvent>;
  readonly projectId: number;
  readonly trees: readonly string[];
};

type Tree = { readonly name: string; readonly detached?: true };

const MIRROR_ONLY = 'written into the mirror alone, so a rebuild from the tree would lose it';

const next = Effect.fnUntraced(function* (events: Queue.Queue<CopyEvent>, kind: CopyEvent['kind'], treeRoot: string) {
  for (;;) {
    const event = yield* Queue.take(events);
    if (event.kind === kind && event.treeRoot === treeRoot) return event;
  }
});

const kept = <A, E>(keeping: Keeping, wanted: readonly Tree[], body: (world: Kept) => Effect.Effect<A, E, Scope.Scope>) =>
  withDemo(({ graph, context, project, demoRoot, fixture }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const alpha = project('alpha');
        yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'stealth' });
        const trees: string[] = [];
        for (const { name, detached } of wanted) {
          const tree = yield* fixture.directory(name);
          const branching = detached === true ? ['--detach', tree, 'HEAD'] : ['-b', name, tree];
          yield* runGit(graph.git, 'worktree', ['worktree', 'add', ...branching], { cwd: alpha.root });
          trees.push(tree);
        }
        const pool = yield* Effect.acquireRelease(
          graphPool({
            migrations: fixtureGraphMigrations,
            identity: testSessionIdentity,
            machine: machineGraphOf(context),
            sourcePath: demoRoot,
          }).pipe(Effect.provideService(CopyKeeping, keeping)),
          (held) => held.dispose(),
        );
        const events = yield* Queue.unbounded<CopyEvent>();
        const unsubscribe = pool.copies.subscribe((event) => Queue.offerUnsafe(events, event));
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
        return yield* body({ pool, events, projectId: alpha.id, trees });
      }),
    ),
  );

layer(demoGraphLayer({ repos: ['alpha'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('pool copies', (it) => {
  it.effect(
    'a copy an act holds through a detached checkout stays past the idle budget and its keeping time, and once let go closes before any copy opens on its tree again from its standing mirror',
    () =>
      kept(
        { idle: 1, ms: 150 },
        [{ name: 'first' }, { name: 'second' }, { name: 'detached', detached: true }],
        ({ pool, events, projectId, trees }) =>
          Effect.gen(function* () {
            const standing = yield* Effect.scoped(
              Effect.gen(function* () {
                const view = yield* pool.hold({ projectId, cwd: trees[2]! });
                expect(view.readOnly).toBeDefined();
                const first = yield* pool.resolve({ projectId, cwd: trees[0]! });
                const second = yield* pool.resolve({ projectId, cwd: trees[1]! });
                yield* next(events, 'closed', first.layout.treeRoot);
                expect(yield* pool.whileClosed(first.layout, Effect.succeed('freed'))).toBe('freed');
                yield* next(events, 'closed', second.layout.treeRoot);
                expect(pool.held().map((copy) => copy.treeRoot)).toEqual([view.layout.treeRoot]);
                const { db } = Context.get(view.context, GraphStore);
                const marked = yield* db.select({ id: block.id }).from(block).where(eq(block.projectId, projectId)).limit(1).get();
                yield* db.update(block).set({ body: MIRROR_ONLY }).where(eq(block.id, marked!.id));
                return { treeRoot: view.layout.treeRoot, id: marked!.id };
              }),
            );
            const { treeRoot, id } = standing;
            yield* next(events, 'closed', treeRoot);
            expect(pool.held()).toEqual([]);
            const reopened = yield* pool.resolve({ projectId });
            expect(yield* Queue.take(events)).toMatchObject({ kind: 'opened', treeRoot });
            const { db } = Context.get(reopened.context, GraphStore);
            expect((yield* db.select({ body: block.body }).from(block).where(eq(block.id, id)).get())?.body).toBe(MIRROR_ONLY);
          }),
      ),
  );
});
