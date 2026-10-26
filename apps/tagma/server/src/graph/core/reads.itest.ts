import { Deferred, Effect, Fiber } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { writes } from '../../platform/contract/service/writes.js';

const testActing = writes('test', []);

layer(demoGraphLayer(), { excludeTestServices: true })('declared reads', (it) => {
  it.effect('a declared read inside an act unit sees what that unit has not committed', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const inside: { titles: readonly string[]; id: number } = { titles: [], id: 0 };
        const rolled = yield* graph.act
          .unit(
            testActing,
            Effect.gen(function* () {
              const made = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'held' });
              inside.id = made.id;
              inside.titles = (yield* graph.selection.records([made.id])).map((row) => row.title);
              return yield* Effect.fail('roll back' as const);
            }),
          )
          .pipe(Effect.result);
        expect(rolled._tag).toBe('Failure');
        if (rolled._tag === 'Failure') expect(rolled.failure).toBe('roll back');
        expect(inside.titles).toEqual(['held']);
        expect(yield* graph.selection.records([inside.id])).toEqual([]);
      }),
    ),
  );

  it.effect('a declared read outside a unit answers while one is open, with the last committed state', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const standing = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'standing' });
        const opened = yield* Deferred.make<number>();
        const letGo = yield* Deferred.make<void>();
        const writing = yield* Effect.forkChild(
          graph.act.unit(
            testActing,
            Effect.gen(function* () {
              const made = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'uncommitted' });
              yield* Deferred.succeed(opened, made.id);
              yield* Deferred.await(letGo);
            }),
          ),
        );
        const heldId = yield* Deferred.await(opened);
        const seen = yield* graph.selection.records([standing.id, heldId]);
        yield* Deferred.succeed(letGo, undefined);
        yield* Fiber.join(writing);
        expect(seen.map((row) => row.title)).toEqual(['standing']);
      }),
    ),
  );
});
