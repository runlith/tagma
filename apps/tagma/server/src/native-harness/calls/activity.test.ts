import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { type AgentCalls, makeAgentCalls } from '@runlith/agent/AgentCalls';
import type { CallEvent, CallRecord } from '@runlith/agent/callProgress';
import { Effect, Fiber, Queue, Result, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { callActivity } from './activity.js';

const PROJECTS = new Map([
  ['a-1', 1],
  ['a-2', 1],
  ['b-1', 2],
]);

const floor = (calls: AgentCalls, history = 200) =>
  callActivity({
    calls,
    projectOf: (threadId: string): Effect.Effect<number | undefined, StoreFailure> => Effect.succeed(PROJECTS.get(threadId)),
  });

const opened = (calls: AgentCalls, threadId: string | null, toolCallId: string, runId = 'run-1') =>
  calls.open({ runId, toolCallId, name: 'read_block', input: { name: 'abcd1234' }, threadId: threadId ?? undefined });

const settled = (call: ReturnType<AgentCalls['open']>) =>
  call.run({
    work: Effect.succeed('done'),
    background: () => 'receipt',
    stopped: () => Effect.succeed('stopped'),
    completed: () => Effect.void,
  });

const ids = (records: readonly CallRecord[]) => records.map((record) => record.toolCallId).sort();

const refusedCode = (result: Result.Result<unknown, unknown>): string | null =>
  Result.isFailure(result) && result.failure instanceof GateRefusal ? result.failure.code : null;

const endingIn = Effect.fnUntraced(function* (frames: Queue.Queue<CallEvent>): Effect.fn.Return<CallEvent> {
  for (let taken = 0; taken < 8; taken += 1) {
    const frame = yield* Queue.take(frames);
    if (frame.type === 'updated' && frame.call.endedAt !== null) return frame;
  }
  return yield* Effect.die(new Error('the feed never delivered the ending'));
});

describe('what one project reads', () => {
  it.effect('the reading carries this project’s threads and nothing of another project or of no thread', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const owner = floor(calls);
      opened(calls, 'a-1', 'mine');
      opened(calls, 'b-1', 'theirs');
      opened(calls, null, 'nowhere');

      expect(ids(yield* owner.snapshot({ projectId: 1 }, 50))).toEqual(['mine']);
      expect(ids(yield* owner.snapshot({ projectId: 2 }, 50))).toEqual(['theirs']);
      expect(ids(yield* owner.snapshot({ projectId: 3 }, 50))).toEqual([]);
    }),
  );

  it.effect('the finished window bounds only what has ended: every standing invocation rides it', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const owner = floor(calls);
      opened(calls, 'a-1', 'standing');
      const first = opened(calls, 'a-1', 'first-over');
      yield* settled(first);
      const second = opened(calls, 'a-1', 'second-over');
      yield* settled(second);

      expect(ids(yield* owner.snapshot({ projectId: 1 }, 0))).toEqual(['standing']);
      expect(ids(yield* owner.snapshot({ projectId: 1 }, 1))).toEqual(['second-over', 'standing']);
      expect(ids(yield* owner.snapshot({ projectId: 1 }, 50))).toEqual(['first-over', 'second-over', 'standing']);
    }),
  );
});

describe('who may control one invocation', () => {
  it.effect('the operator’s hand reaches any invocation of its project and no other project’s', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const owner = floor(calls);
      opened(calls, 'a-1', 'mine');
      opened(calls, 'b-1', 'theirs');

      const answer = yield* owner.control({ projectId: 1 }, { runId: 'run-1', toolCallId: 'mine' }, { action: 'stop' });
      expect(answer.status).toBe('changed');

      const refused = yield* Effect.result(owner.control({ projectId: 1 }, { runId: 'run-1', toolCallId: 'theirs' }, { action: 'stop' }));
      expect(refusedCode(refused)).toBe('unknown-invocation');
      const absent = yield* Effect.result(owner.control({ projectId: 1 }, { runId: 'run-1', toolCallId: 'never' }, { action: 'stop' }));
      expect(refusedCode(absent)).toBe('unknown-invocation');
    }),
  );

  it.effect('an acting thread reaches its own invocation alone, and only under a project that holds it', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const owner = floor(calls);
      opened(calls, 'a-1', 'mine');
      opened(calls, 'a-2', 'sibling');

      const own = yield* owner.control({ projectId: 1, threadId: 'a-1' }, { runId: 'run-1', toolCallId: 'mine' }, { action: 'stop' });
      expect(own.status).toBe('changed');

      const sibling = yield* Effect.result(
        owner.control({ projectId: 1, threadId: 'a-1' }, { runId: 'run-1', toolCallId: 'sibling' }, { action: 'stop' }),
      );
      expect(refusedCode(sibling)).toBe('unknown-invocation');

      const wrongLens = yield* Effect.result(
        owner.control({ projectId: 2, threadId: 'a-1' }, { runId: 'run-1', toolCallId: 'mine' }, { action: 'stop' }),
      );
      expect(refusedCode(wrongLens)).toBe('unknown-invocation');
      expect(ids(yield* owner.snapshot({ projectId: 2, threadId: 'a-1' }, 50))).toEqual([]);
    }),
  );
});

describe('what a subscription is handed', () => {
  it.effect('the opening window is this project’s, a movement of another project is dropped, and an ending is delivered', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const owner = floor(calls);
      opened(calls, 'a-1', 'standing');
      opened(calls, 'b-1', 'theirs');

      const frames = yield* Queue.make<CallEvent>();
      const feeding = yield* Effect.forkChild(Stream.runForEach(owner.feed({ projectId: 1 }, 50), (frame) => Queue.offer(frames, frame)));

      const opening = yield* Queue.take(frames);
      expect(opening.type).toBe('snapshot');
      if (opening.type !== 'snapshot') return yield* Effect.die(new Error('the feed did not open on a window'));
      expect(ids(opening.calls)).toEqual(['standing']);

      opened(calls, 'b-1', 'theirs-moved');
      const moving = opened(calls, 'a-1', 'mine-moved');
      const movement = yield* Queue.take(frames);
      expect(movement.type).toBe('updated');
      if (movement.type !== 'updated') return yield* Effect.die(new Error('a movement did not arrive as its own frame'));
      expect(movement.call.toolCallId).toBe('mine-moved');

      yield* settled(moving);
      const ending = yield* endingIn(frames);
      if (ending.type !== 'updated') return yield* Effect.die(new Error('the ending did not arrive as its own frame'));
      expect(ending.call.toolCallId).toBe('mine-moved');
      expect(ending.call.endedAt).not.toBeNull();

      yield* Fiber.interrupt(feeding);
    }),
  );
});
