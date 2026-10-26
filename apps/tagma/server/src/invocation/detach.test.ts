import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { CallEnding, OwedCalls } from '../threads/contract/service/owedCalls.js';
import { detaching, type DetachedAnswer } from './detach.js';

const endings = Effect.fnUntraced(function* (answers: readonly DetachedAnswer[]) {
  const ended: CallEnding[] = [];
  const owed: OwedCalls['Service'] = {
    owe: () => Effect.void,
    began: () => Effect.die('No call begins in this scenario.'),
    end: () => Effect.void,
    take: () => Effect.succeed({ status: 'none' }),
    owed: () => Effect.succeed([]),
    detached: (_call, work, _stopped, ending) =>
      Effect.tap(Effect.exit(work), (exit) => Effect.sync(() => ended.push(ending(exit, false)))),
  };
  for (const answer of answers)
    yield* detaching(owed)({ threadId: 'lead', runId: 'run-1', name: 'op', input: {} }, Effect.succeed(answer), true);
  return ended;
});

it.effect('a background operation ends owed with the threads its answer names', () =>
  Effect.gen(function* () {
    const answer = {
      threadId: 'child-1',
      _meta: { toolDisplay: { form: 'none', reference: { kind: 'thread', id: 'child-1', projectId: 2 } } },
    };
    const ended = yield* endings([
      { answer, outcome: 'answer' },
      { answer: { block: 'b' }, outcome: 'answer' },
    ]);
    expect(ended.map((ending) => (ending.outcome === 'completed' ? ending.threads : null))).toEqual([
      [{ threadId: 'child-1', projectId: 2, name: null }],
      [],
    ]);
  }),
);

it.effect('a background operation that answers negative ends failed', () =>
  Effect.gen(function* () {
    const ended = yield* endings([{ answer: { status: 'refused' }, outcome: 'negative' }]);
    expect(ended.map((ending) => ending.outcome)).toEqual(['failed']);
  }),
);
