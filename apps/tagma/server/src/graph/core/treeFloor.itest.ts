import { eq, sql } from 'drizzle-orm';
import { type Context, Deferred, Effect, Exit, Fiber } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { block } from '../store/tables.js';
import { TreeGuard } from '../contract/service/acts.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';
import { writes } from '../../platform/contract/service/writes.js';

const testActing = writes('test', []);

type Floor = NonNullable<Context.Service.Shape<typeof TreeGuard>>;

const lens = ({ graph, projectId, root }: EffectDemo) => {
  const probeWrite = (table: string) =>
    graph.units
      .write('treeFloor.probeWrite', (unit) => unit.run(graph.graphStore.db.run(sql.raw(`create table ${table} (id integer primary key)`))))
      .pipe(Effect.exit);
  const acting = (floor: Floor, title: string) =>
    Effect.forkChild(
      graph.act
        .unit(testActing, graph.blocks.create({ projectId, tags: ['idea'], title, parentId: root }))
        .pipe(Effect.provideService(TreeGuard, floor)),
    );
  return { probeWrite, acting };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer(), { excludeTestServices: true })('tree floor', (it) => {
  it.effect('an act waiting in its tree floor guard leaves the database writer free', () =>
    withLens(({ acting, probeWrite }) =>
      Effect.gen(function* () {
        const inGuard = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const floor: Floor = {
          writes: testActing,
          guard: (act) => Deferred.succeed(inGuard, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(act)),
          prepare: Effect.succeed({ write: () => Effect.succeed(Effect.void), undo: Effect.void }),
        };
        const fiber = yield* acting(floor, 'guarded');
        yield* Deferred.await(inGuard);
        const other = yield* probeWrite('guard_probe');
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
        expect(Exit.isSuccess(other)).toBe(true);
      }),
    ),
  );

  it.effect('reading the tree before an act leaves the database writer free', () =>
    withLens(({ acting, probeWrite }) =>
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const floor: Floor = {
          writes: testActing,
          guard: (act) => act,
          prepare: Effect.gen(function* () {
            yield* Deferred.succeed(reading, undefined);
            yield* Deferred.await(release);
            return { write: () => Effect.succeed(Effect.void), undo: Effect.void };
          }),
        };
        const fiber = yield* acting(floor, 'read first');
        yield* Deferred.await(reading);
        const other = yield* probeWrite('reading_probe');
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
        expect(Exit.isSuccess(other)).toBe(true);
      }),
    ),
  );

  it.effect('an act lands its tree after its commit: the rows already stand and another writer runs while it lands', () =>
    withLens(({ graph, acting, probeWrite }) =>
      Effect.gen(function* () {
        const landing = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const guard = { held: false };
        const floor: Floor = {
          writes: testActing,
          guard: (act) =>
            Effect.andThen(
              Effect.sync(() => (guard.held = true)),
              act,
            ).pipe(Effect.tap(() => Effect.sync(() => (guard.held = false)))),
          prepare: Effect.succeed({
            write: () =>
              Effect.succeed(
                Effect.gen(function* () {
                  yield* Deferred.succeed(landing, undefined);
                  yield* Deferred.await(release);
                }),
              ),
            undo: Effect.void,
          }),
        };
        const fiber = yield* acting(floor, 'landing');
        yield* Deferred.await(landing);
        const underGuard = guard.held;
        const other = yield* probeWrite('landing_probe');
        const standing = yield* graph.graphStore.db.select({ id: block.id }).from(block).where(eq(block.title, 'landing'));
        yield* Deferred.succeed(release, undefined);
        const written = yield* Fiber.join(fiber);
        expect(underGuard).toBe(true);
        expect(Exit.isSuccess(other)).toBe(true);
        expect(standing.map((row) => row.id)).toEqual([written.id]);
      }),
    ),
  );
});
