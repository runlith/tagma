import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import type { AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import type { ThreadContext } from '../turns/context.js';
import { touchMarks, touchRule } from './touchRule.js';

it.effect('a touch brief that cannot be read fails the rule, so the policy notes it instead of hearing a quiet non-match', () =>
  Effect.gen(function* () {
    const lost = new Error('the brief store went away');
    const ctx = {
      hook: 'afterTool',
      tool: { name: 'read', shown: [{ path: 'src/a.ts' }] },
      world: { facts: { shared: false } },
      graphRoot: '/repo',
      graph: Effect.succeed(Context.empty()),
      target: { graph: { projectId: 1 } },
      projectId: 1,
      thread: { id: 'thread-1', transcript: [] },
      modelMessages: [],
      identity: 'thread-1',
      execution: { touched: () => Effect.fail(lost) },
    } as unknown as AgentRuleContext<ThreadContext>;

    const failure = yield* Effect.flip(touchRule(touchMarks(), () => 'graph')(ctx));

    expect(failure).toBe(lost);
  }),
);
