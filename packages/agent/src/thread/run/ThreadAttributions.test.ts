import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { ThreadEventJournal } from '../ThreadPorts';
import { ThreadEntryKinds } from '../../transcript/kinds';
import type { ThreadEventRecord } from '../events';
import { ThreadStorageFailed } from '../persisted';
import { ThreadAttributions, threadAttributionsLayer } from './ThreadAttributions';
function journal() {
  const records: ThreadEventRecord[] = [];
  let budget = 0;
  const port: ThreadEventJournal['Service'] = {
    append: () => Effect.die('not a writer'),
    eventsAfter: () => Effect.die('use a pinned head'),
    revisionsAsOf: () => Effect.die('not a revision reader'),
    positionOf: () => Effect.succeed(null),
    headPosition: () => Effect.succeed(records.length),
    recordsAsOf: (_id, window) =>
      Effect.suspend(() => {
        const page = records
          .filter((record) => record.position > window.afterPosition && record.position <= window.head)
          .slice(0, window.limit);
        budget -= page.length;
        return budget < 0
          ? Effect.fail(new ThreadStorageFailed({ call: 'recordsAsOf', cause: new Error('The journal read exceeded its row budget.') }))
          : Effect.succeed(page);
      }),
  };
  return {
    port,
    records,
    allow(rows: number) {
      budget = rows;
    },
    append(kind: string, payload: ThreadEventRecord['payload']) {
      records.push({ id: String(records.length + 1), position: records.length + 1, threadId: 'thread', kind, payload });
    },
  };
}
it.effect(
  'concurrent attribution reads share the prefix and new heads spend only appended rows, with exact restore bytes',
  Effect.fnUntraced(function* () {
    const source = journal();
    const words = Message.user('one');
    const answer = Message.assistant('x'.repeat(2048));
    source.append('message', { entry: { id: 'words', type: 'message', role: 'user', runId: 'run', text: 'one' }, messages: [words] });
    source.append('context', { messages: [answer] });
    const at = '2026-09-30T00:00:00.000Z';
    source.append('run-end', {
      entry: { id: 'end', type: 'run-end', runId: 'run', status: 'completed', startedAt: at, finishedAt: at, occurredAt: at },
    });
    source.allow(3);
    const layer = threadAttributionsLayer.pipe(
      Layer.provide(Layer.merge(Layer.succeed(ThreadEventJournal, source.port), ThreadEntryKinds.layer([]))),
    );
    const attributions = Context.get(yield* Layer.build(layer), ThreadAttributions);
    const [first, same] = yield* Effect.all([attributions.read('thread', 3), attributions.read('thread', 3)], { concurrency: 2 });
    expect(first.points()).toEqual(same.points());
    expect(first.points().points).toEqual([{ runId: 'run', rewindable: true }]);
    expect(first.retainedBytes).toBeLessThan(2048);
    const cut = first.plan('run', 'turn');
    if ('blocked' in cut) return yield* Effect.die(cut.blocked);
    source.append('rewind', { rewound: { id: 'rewind', scope: 'turn', ...cut } });
    source.allow(1);
    const taken = yield* attributions.read('thread', 4);
    expect(taken.points().points).toEqual([{ runId: 'run', rewindable: false, reason: 'rewind-rewound' }]);
    expect(first.points().points).toEqual([{ runId: 'run', rewindable: true }]);
    const plan = taken.restorePlan('rewind');
    if ('refused' in plan) return yield* Effect.die(plan.refused);
    source.allow(2);
    const inserts = yield* attributions.restore('thread', plan);
    expect(inserts).toEqual([{ at: 0, messages: [words, answer] }]);
    source.append('restore', { restored: { rewindId: 'rewind', runIds: plan.runIds, inserts } });
    source.allow(1);
    const restored = yield* attributions.read('thread', 5);
    expect(restored.points()).toEqual(first.points());
  }),
);
