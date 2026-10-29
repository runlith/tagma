import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';
import type { RuleSetup } from '../contract/service/rules.js';
import type { ThreadContext } from '../turns/context.js';
import type { Capability } from './contract.js';
import { cueSource } from './cueRule.js';

const cued: Capability = {
  id: 'fixture',
  description: 'Fixture',
  sections: [],
  guide: 'Ask the fixture first.',
  cue: { tool: 'grep', input: 'pattern', matches: String.raw`\\\.get` },
};

it.effect('a cue the agent never received, as after a call that went to the background, is offered again until one is delivered', () =>
  Effect.gen(function* () {
    const rule = cueSource.create({
      declaration: { id: 'fixture-agent' },
      definitions: { effective: () => ({ held: [cued] }) },
    } as unknown as RuleSetup);
    const after = (modelMessages: readonly Message[]) =>
      ({
        hook: 'afterTool',
        tool: { name: 'grep', input: { pattern: String.raw`store\.get\(` } },
        thread: { id: 'thread-1', profile: null },
        capabilitySettings: { enabled: () => true },
        world: { facts: {} },
        comments: () => 'allow',
        modelMessages,
      }) as unknown as AgentRuleContext<ThreadContext>;

    const evaluated = yield* rule(after([]));
    expect(evaluated?.type).toBe('guide');
    expect((yield* rule(after([])))?.type).toBe('guide');
    if (evaluated?.type !== 'guide') return;
    expect(yield* rule(after([agentRuntimeGuidanceMessage(evaluated.text, evaluated.state)]))).toBeNull();
  }),
);
