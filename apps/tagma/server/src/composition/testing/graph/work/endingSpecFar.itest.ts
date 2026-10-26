import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../../callers.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { fixtureNativeCatalog } from '../../nativeCatalog.js';
import { sessionIdentity } from '../../../../external-harnesses/sessionPrefix.js';
import { testSessionIdentity } from '../../../../platform/testing/identity.js';
import { onGraph, signedBy } from '../../../../invocation/testing/call.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { Tags } from '../../../../graph/contract/service/vocabulary.js';
import type { ServedGraph } from '../../../../graph/contract/service/serving.js';
import { blockName } from '../../../../graph/contract/wire/references.js';
import { graphPool, machineGraphOf } from '../../../../graph/testing/doubles.js';
import { routedContext } from '../../../../graph/serving/routing.js';

const signed = signedBy({ harness: 'test', key: 'ending-spec-far' });

layer(demoGraphLayer({ repos: ['front', 'back'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('ending the last task of a spec in another project', (it) => {
  it.effect('a spec in another project is named by the last task that implements it, and not before', () =>
    withDemo(({ graph, context, project, demoRoot }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const front = project('front');
          const back = project('back');
          yield* graph.projectPolicy.setStorage({ id: front.id, mode: 'team' });
          yield* graph.projectPolicy.setStorage({ id: back.id, mode: 'team' });
          const machine = machineGraphOf(context);
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
            (held) => held.dispose(),
          );
          const routed = routedContext(machine, pool);
          const servedFront = yield* pool.resolve({ projectId: front.id });
          const servedBack = yield* pool.resolve({ projectId: back.id });
          const within = <A, E>(served: ServedGraph, work: Effect.Effect<A, E, Blocks>) =>
            Effect.provide(onGraph(served)(signed(work)), routed) as Effect.Effect<A, E>;
          const tools = Effect.fnUntraced(function* (served: ServedGraph, projectId: number, name: string) {
            const vocabulary = yield* Effect.provide(
              Effect.flatMap(Tags, (tags) => tags.reader(projectId)),
              served.context,
            );
            let calls = 0;
            return Effect.fnUntraced(function* (tool: string, input: Record<string, unknown>) {
              const catalog = yield* fixtureNativeCatalog(
                {
                  caller: { actor: { kind: 'operator' }, files: null },
                  place: { root: served.checkout, origin: null },
                  project: { id: projectId, name },
                  vocabulary,
                  identity: sessionIdentity,
                  world: 'checkout',
                  graphRoot: served.layout.treeRoot,
                  owners: routed,
                  served,
                },
                ['link_blocks', 'finish_block'],
              );
              const entry = catalog[tool];
              if (entry === undefined) return yield* Effect.die(`no ${tool} tool`);
              const key = `${name}-${++calls}`;
              const prepared = yield* (
                toolPrepare(entry)?.(input, { toolCallId: key, caller: unthreadedCaller }) ?? Effect.succeed(undefined)
              );
              const answered = yield* toolExecute(entry)!(input, {
                toolCallId: key,
                caller: unthreadedCaller,
                messages: [],
                prepared: prepared?.prepared,
              });
              return (answered instanceof ToolAnswer ? answered.value : answered) as { specs?: { name: string; title: string }[] };
            });
          });
          const inFront = yield* tools(servedFront, front.id, 'front');
          const inBack = yield* tools(servedBack, back.id, 'back');
          const create = (served: ServedGraph, projectId: number, tag: string, title: string, parentId?: number) =>
            within(
              served,
              Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId, tags: [tag], title, parentId })),
            );

          const spec = yield* create(servedBack, back.id, 'spec', 'Served from the back');
          const own = yield* create(servedBack, back.id, 'task', 'Back task', spec.id);
          const implementing = yield* create(servedFront, front.id, 'task', 'Front task');
          const specName = blockName(spec.uuid);
          const implementingName = blockName(implementing.uuid);
          expect(yield* inFront('link_blocks', { fromId: implementingName, kind: 'implements', toId: specName })).toMatchObject({
            status: 'ok',
          });

          expect((yield* inBack('finish_block', { blockId: blockName(own.uuid) })).specs).toBeUndefined();
          const last = yield* inFront('finish_block', { blockId: implementingName });
          expect(last.specs).toEqual([{ name: `${back.id}/${specName}`, title: 'Served from the back' }]);

          const busy = yield* create(servedBack, back.id, 'spec', 'Still busy in the back');
          yield* create(servedBack, back.id, 'task', 'Open back task', busy.id);
          const other = yield* create(servedFront, front.id, 'task', 'Other front task');
          yield* inFront('link_blocks', { fromId: blockName(other.uuid), kind: 'implements', toId: blockName(busy.uuid) });
          expect((yield* inFront('finish_block', { blockId: blockName(other.uuid) })).specs).toBeUndefined();

          const bare = yield* create(servedBack, back.id, 'spec', 'Implemented from the front only');
          const firstFront = yield* create(servedFront, front.id, 'task', 'First front implementer');
          const secondFront = yield* create(servedFront, front.id, 'task', 'Second front implementer');
          for (const one of [firstFront, secondFront]) {
            yield* inFront('link_blocks', { fromId: blockName(one.uuid), kind: 'implements', toId: blockName(bare.uuid) });
          }
          expect((yield* inFront('finish_block', { blockId: blockName(firstFront.uuid) })).specs).toBeUndefined();
          expect((yield* inFront('finish_block', { blockId: blockName(secondFront.uuid) })).specs).toEqual([
            { name: `${back.id}/${blockName(bare.uuid)}`, title: 'Implemented from the front only' },
          ]);
        }),
      ),
    ),
  );
});
