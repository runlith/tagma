import { randomUUID } from 'node:crypto';
import { Clock, Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { demoGraphLayer, tempRootEffect, withDemo } from './graphFixture.js';

const timed = Effect.fnUntraced(function* <A, E, R>(label: string, work: Effect.Effect<A, E, R>) {
  const started = yield* Clock.monotonicTimeNanos;
  const answer = yield* work;
  const ended = yield* Clock.monotonicTimeNanos;
  console.log(`${label.padEnd(34)} ${Number(ended - started) / 1_000_000} ms`);
  return answer;
});

const program = withDemo((demo) =>
  Effect.gen(function* () {
    const root = yield* tempRootEffect(demo.fixture, 'probe-');
    const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'probe', rootPath: root })).id;
    const parentId = (yield* demo.graph.blocks.rootBlockOf(projectId)).id;
    for (let round = 0; round < 3; round += 1) {
      yield* timed('one create', demo.graph.blocks.create({ projectId, parentId, tags: ['idea'], title: `one ${randomUUID()}` }));
    }
    yield* timed(
      'ten creates, one at a time',
      Effect.gen(function* () {
        for (let n = 0; n < 10; n += 1) {
          yield* demo.graph.blocks.create({ projectId, parentId, tags: ['idea'], title: `single ${randomUUID()}` });
        }
      }),
    );
  }),
).pipe(Effect.provide(demoGraphLayer()), Effect.provide(BunFileSystem.layer));

BunRuntime.runMain(program);
