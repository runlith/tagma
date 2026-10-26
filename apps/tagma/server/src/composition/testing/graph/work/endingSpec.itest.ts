import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { withGraphCall, forProject } from '../../../../invocation/testing/call.js';
import { execute, prepare } from '../../../../invocation/testing/performing.js';
import type { Bound } from '../../../../platform/contract/service/body.js';
import type { Caller } from '../../../../platform/contract/wire/caller.js';
import { WORK_PAIRS } from '../../../../graph/operations/work.js';
import { knownAnswer } from '../../../../platform/contract/wire/operation.js';
import { WORK_OPERATIONS } from '../../../../graph/contract/wire/operations/work.js';

const ended = Schema.decodeUnknownEffect(knownAnswer(WORK_OPERATIONS.finish_block.answer));
const batched = Schema.decodeUnknownEffect(knownAnswer(WORK_OPERATIONS.apply_batch.answer));

layer(demoGraphLayer(), { excludeTestServices: true })('ending the last task of a spec', (it) => {
  it.effect('names the open spec left without active work, whether its tasks stand under it or implement it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const caller: Caller = { actor: { kind: 'operator' }, files: null };
        const here = Effect.succeed({
          project: { id: projectId, name: 'demo' },
          vocabulary: yield* demo.table(),
          lens: { scope: undefined, names: 'law-and-reflections' as const },
          deliveredTags: new Set<string>(),
        });
        const call = <Input, Prepared, Answer, R, E>(bound: Bound<Input, Prepared, Answer, R, E>, input: NoInfer<Input>) =>
          Effect.flatMap(prepare(bound, input, caller), (prepared) => execute(bound, input, prepared, caller)).pipe(
            withGraphCall(here),
            forProject(here),
          );
        const finish = Effect.fnUntraced(function* (id: number) {
          const raw = yield* call({ ...WORK_PAIRS.finish_block.body, id: WORK_PAIRS.finish_block.id }, { blockId: yield* demo.nameOf(id) });
          return yield* ended(raw);
        });
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'Built in two tasks' });
        const first = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'First', parentId: spec.id });
        const second = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Second', parentId: spec.id });
        const outside = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Implements from outside' });
        yield* graph.edges.link({ fromId: outside.id, kind: 'implements', toId: spec.id });

        expect((yield* finish(first.id)).specs).toBeUndefined();
        expect((yield* finish(second.id)).specs).toBeUndefined();
        const last = yield* finish(outside.id);
        expect(last.specs?.map(({ name, title }) => ({ name, title }))).toEqual([
          { name: yield* demo.nameOf(spec.id), title: 'Built in two tasks' },
        ]);

        const tree = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'Built under itself' });
        const only = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Only', parentId: tree.id });
        expect((yield* finish(only.id)).specs?.map(({ name }) => name)).toEqual([yield* demo.nameOf(tree.id)]);
      }),
    ),
  );

  it.effect('apply_batch names the spec its finish, close and supersede ops leave without open work', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const caller: Caller = { actor: { kind: 'operator' }, files: null };
        const here = Effect.succeed({
          project: { id: projectId, name: 'demo' },
          vocabulary: yield* demo.table(),
          lens: { scope: undefined, names: 'law-and-reflections' as const },
          deliveredTags: new Set<string>(),
        });
        const batch = Effect.fnUntraced(function* (ops: readonly Record<string, unknown>[]) {
          const bound = { ...WORK_PAIRS.apply_batch.body, id: WORK_PAIRS.apply_batch.id };
          const input = { ops } as never;
          const raw = yield* Effect.flatMap(prepare(bound, input, caller), (prepared) => execute(bound, input, prepared, caller)).pipe(
            withGraphCall(here),
            forProject(here),
          );
          return yield* batched(raw);
        });
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'Ended by batch' });
        const kept = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Kept', parentId: spec.id });
        const closed = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Closed', parentId: spec.id });
        const replaced = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Replaced', parentId: spec.id });
        const successor = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Successor' });
        const specName = yield* demo.nameOf(spec.id);

        expect(
          (yield* batch([
            { op: 'finish', id: yield* demo.nameOf(kept.id) },
            { op: 'close', id: yield* demo.nameOf(closed.id) },
          ])).specs,
        ).toBeUndefined();
        const last = yield* batch([{ op: 'supersede', oldId: yield* demo.nameOf(replaced.id), withId: yield* demo.nameOf(successor.id) }]);
        expect(last.specs?.map(({ name }) => name)).toEqual([specName]);

        const whole = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'Ended by one batch' });
        const parts = yield* Effect.forEach(['One', 'Two', 'Three'], (title) =>
          graph.blocks.create({ projectId, tags: ['task'], title, parentId: whole.id }),
        );
        const names = yield* Effect.forEach(parts, (part) => demo.nameOf(part.id));
        const together = yield* batch([
          { op: 'finish', id: names[0] ?? '' },
          { op: 'close', id: names[1] ?? '' },
          { op: 'finish', id: names[2] ?? '' },
        ]);
        expect(together.specs?.map(({ name }) => name)).toEqual([yield* demo.nameOf(whole.id)]);
      }),
    ),
  );
});
