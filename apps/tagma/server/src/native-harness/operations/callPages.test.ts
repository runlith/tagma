import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { type AgentCalls, makeAgentCalls } from '@runlith/agent/AgentCalls';
import { mintCursor } from '@runlith/paging';
import { Effect, Result } from 'effect';
import { readCalls } from './calls.js';
import { callActivity } from '../calls/activity.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { TagIndex } from '../../graph/vocabulary/tagIndex.js';
import { CallActivity } from '../contract/service/calls.js';
import { OwedCalls } from '../../threads/contract/service/owedCalls.js';
import { forProject } from '../../invocation/testing/call.js';
import { GRAPH_BEHAVIOURS } from '../../graph/testing/behaviours.js';

const projectCall = {
  project: { id: 1, name: 'calls' },
  vocabulary: new TagIndex([], GRAPH_BEHAVIOURS),
  lens: { scope: undefined, names: 'law-and-reflections' as const },
  deliveredTags: new Set<string>(),
};

const nothingOwed: OwedCalls['Service'] = {
  owe: () => Effect.void,
  began: () => Effect.die('No call begins in this scenario.'),
  end: () => Effect.void,
  owed: () => Effect.succeed([]),
  detached: (_call, work) => work,
};

const operator: Caller = { actor: { kind: 'operator' }, files: null };

const thread = (threadId: string): Caller => ({
  actor: { kind: 'thread', threadId, projectId: 1, principalId: 'owner', session: { harness: 'tagma', key: threadId } },
  files: null,
});

const refusedCode = (result: Result.Result<unknown, unknown>): string | null =>
  Result.isFailure(result) && result.failure instanceof GateRefusal ? result.failure.code : null;

it.live('the walk reaches every held invocation once, standing first, with the total beside it', () =>
  Effect.gen(function* () {
    const calls = yield* makeAgentCalls({ history: 200 });
    const activity = callActivity({ calls, projectOf: () => Effect.succeed(1) });
    const over = (name: string) => {
      const call = calls.open({ runId: 'run-1', toolCallId: name, threadId: 't-1', name: 'probe', input: {} });
      return call.run({
        work: Effect.succeed('done'),
        background: () => 'receipt',
        stopped: () => Effect.succeed('stopped'),
        completed: () => Effect.void,
      });
    };
    calls.open({ runId: 'run-1', toolCallId: 'standing-a', threadId: 't-1', name: 'probe', input: {} });
    calls.open({ runId: 'run-1', toolCallId: 'standing-b', threadId: 't-1', name: 'probe', input: {} });
    yield* over('first-over');
    yield* over('second-over');
    yield* over('third-over');

    const seen: string[] = [];
    const phases: string[] = [];
    let cursor: string | undefined;
    let total = 0;
    for (let step = 0; step < 10; step += 1) {
      const answer = yield* readCalls({ limit: 2, cursor }, undefined, operator).pipe(
        forProject(Effect.succeed(projectCall)),
        Effect.provideService(CallActivity, activity),
        Effect.provideService(OwedCalls, nothingOwed),
      );
      total = answer.total;
      expect(answer.complete).toBe(true);
      seen.push(...answer.calls.map((record) => record.toolCallId));
      phases.push(...answer.calls.map((record) => record.phase));
      if (answer.next === null) break;
      cursor = answer.next;
    }
    expect(total).toBe(5);
    expect(seen.sort()).toEqual(['first-over', 'second-over', 'standing-a', 'standing-b', 'third-over']);
    expect(phases.slice(0, 2)).toEqual(['preparing', 'preparing']);
  }),
);

it.live('a cursor minted for another operation, and a forged word, are refused without a reading', () =>
  Effect.gen(function* () {
    const calls = yield* makeAgentCalls({ history: 200 });
    const activity = callActivity({ calls, projectOf: () => Effect.succeed(1) });
    const asking = (cursor: string) =>
      readCalls({ cursor }, undefined, operator).pipe(
        forProject(Effect.succeed(projectCall)),
        Effect.provideService(CallActivity, activity),
        Effect.provideService(OwedCalls, nothingOwed),
      );
    const foreign = mintCursor({ operation: 'read_terminals', selection: { projectId: 1 }, order: 1 }, [1, 'exec-1']);
    expect(refusedCode(yield* Effect.result(asking(foreign)))).toBe('cursor-stale');
    expect(refusedCode(yield* Effect.result(asking('a-word-this-read-never-minted')))).toBe('bad-cursor');
  }),
);

it.live('a cursor minted for the operator does not walk another session’s narrowing', () =>
  Effect.gen(function* () {
    const calls = yield* makeAgentCalls({ history: 200 });
    const activity = callActivity({
      calls,
      projectOf: (threadId) => Effect.succeed(threadId === 't-1' ? 1 : 2),
    });
    calls.open({ runId: 'run-1', toolCallId: 'mine', threadId: 't-1', name: 'probe', input: {} });
    calls.open({ runId: 'run-1', toolCallId: 'mine-too', threadId: 't-1', name: 'probe', input: {} });
    const first = yield* readCalls({ limit: 1 }, undefined, operator).pipe(
      forProject(Effect.succeed(projectCall)),
      Effect.provideService(CallActivity, activity),
      Effect.provideService(OwedCalls, nothingOwed),
    );
    expect(first.next).not.toBeNull();
    const reread = yield* Effect.result(
      readCalls({ cursor: first.next ?? undefined }, undefined, thread('t-1')).pipe(
        forProject(Effect.succeed(projectCall)),
        Effect.provideService(CallActivity, activity),
        Effect.provideService(OwedCalls, nothingOwed),
      ),
    );
    expect(refusedCode(reread)).toBe('cursor-stale');
  }),
);
