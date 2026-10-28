import { type Context, Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { TreeGuard } from '../contract/service/acts.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { writes } from '../../platform/contract/service/writes.js';

const testActing = writes('test', []);

type Floor = NonNullable<Context.Service.Shape<typeof TreeGuard>>;

layer(demoGraphLayer(), { excludeTestServices: true })('act landing', (it) => {
  it.effect('the tree write of an act receives the entries it recorded, and none of a nested unit that rolled back', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const landed: { readonly op: string; readonly blockId: number | null }[] = [];
        const floor: Floor = {
          writes: testActing,
          guard: (act) => act,
          prepare: Effect.succeed({
            write: (entries) => {
              landed.push(...entries.map((entry) => ({ op: entry.op, blockId: entry.blockId })));
              return Effect.succeed(Effect.void);
            },
            undo: Effect.void,
          }),
        };
        const kept = yield* graph.act
          .unit(
            testActing,
            Effect.gen(function* () {
              const first = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'kept', body: 'stays', parentId: root });
              const nested = yield* Effect.result(
                graph.act.unit(
                  testActing,
                  Effect.gen(function* () {
                    yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'rolled back', body: 'goes', parentId: root });
                    return yield* Effect.fail('nested unit fails');
                  }),
                ),
              );
              expect(nested._tag).toBe('Failure');
              return first.id;
            }),
          )
          .pipe(Effect.provideService(TreeGuard, floor));
        expect(landed).toEqual([{ op: 'create', blockId: kept }]);
      }),
    ),
  );
});
