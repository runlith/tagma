import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { forProject, withGraphCall } from '../../../../invocation/testing/call.js';
import { execute, prepare } from '../../../../invocation/testing/performing.js';
import type { Bound } from '../../../../platform/contract/service/body.js';
import type { Caller } from '../../../../platform/contract/wire/caller.js';
import { WORK_PAIRS } from '../../../../graph/operations/work.js';
import { WorkEnds, type WorkEnded } from '../../../../graph/contract/service/workEnds.js';

layer(demoGraphLayer(), { excludeTestServices: true })('work ends', (it) => {
  it.effect('a task a thread finishes or closes is published with that thread; a spec, or a task the operator ends, is not', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const thread: Caller = {
          actor: {
            kind: 'thread',
            threadId: 'thread-a',
            projectId,
            principalId: 'operator',
            session: { harness: 'tagma', key: 'thread-a' },
          },
          files: null,
        };
        const operator: Caller = { actor: { kind: 'operator' }, files: null };
        const here = Effect.succeed({
          project: { id: projectId, name: 'demo' },
          vocabulary: yield* demo.table(),
          lens: { scope: undefined, names: 'law-and-reflections' as const },
          deliveredTags: new Set<string>(),
        });
        const call = <Input, Prepared, Answer, R, E>(caller: Caller, bound: Bound<Input, Prepared, Answer, R, E>, input: NoInfer<Input>) =>
          Effect.flatMap(prepare(bound, input, caller), (prepared) => execute(bound, input, prepared, caller)).pipe(
            withGraphCall(here),
            forProject(here),
          );
        const finish = { ...WORK_PAIRS.finish_block.body, id: WORK_PAIRS.finish_block.id };
        const close = { ...WORK_PAIRS.close_block.body, id: WORK_PAIRS.close_block.id };
        const heard: WorkEnded[] = [];
        const leave = (yield* WorkEnds).subscribe((event) => Effect.sync(() => void heard.push(event)));
        const created = (tag: string, title: string) => graph.blocks.create({ projectId, tags: [tag], title });
        const finished = yield* created('task', 'Ship it');
        const closed = yield* created('task', 'Drop it');
        const spec = yield* created('spec', 'Agree it');
        const operators = yield* created('task', 'Operator ends it');
        const names = yield* Effect.forEach([finished, closed, spec, operators], (block) => demo.nameOf(block.id));
        yield* call(thread, finish, { blockId: names[0]!, commit: 'abc1234' });
        yield* call(thread, close, { blockId: names[1]! });
        yield* call(thread, close, { blockId: names[2]! });
        yield* call(operator, finish, { blockId: names[3]! });
        leave();
        expect(heard).toEqual([
          { threadId: 'thread-a', projectId, block: names[0]!, title: 'Ship it', word: 'done', commit: 'abc1234' },
          { threadId: 'thread-a', projectId, block: names[1]!, title: 'Drop it', word: 'closed', commit: null },
        ]);
      }),
    ),
  );
});
