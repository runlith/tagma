import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { AgentRunState } from '@runlith/agent/AgentRunState';
import { AgentRuntimePolicy, agentGuides, type AgentDirective } from '@runlith/agent/AgentRuntimePolicy';
import type { RunBudget } from '@runlith/agent/thread/agents/AgentProfile';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { budgetSource } from './budgetRule.js';

const gate = (budget: RunBudget | undefined, startedAt?: number) => {
  const policy = new AgentRuntimePolicy([budgetSource.create({} as never)]);
  const run = new AgentRunState({ startedAt });
  const thread = { profile: budget === undefined ? null : { id: 'reader', overlay: { budget } } };
  const step = () =>
    policy.evaluate({
      thread,
      run,
      runId: 'run-1',
      invocationKey: `at:${run.stepNumber}`,
      ordinal: run.stepNumber + 1,
      hook: 'beforeStep',
      modelMessages: [],
    } as never);
  return { run, step };
};

const answerStep = (directives: readonly AgentDirective[]): boolean =>
  directives.some((directive) => directive.type === 'restrict' && directive.tools.length === 0);

it.effect('a thread whose definition sets no budget is never gated', () =>
  Effect.gen(function* () {
    const { run, step } = gate(undefined);
    for (let at = 0; at < 3; at += 1) {
      expect(yield* step()).toEqual([]);
      run.commitStep();
    }
  }),
);

it.effect('the steps budget guides once at 70% and takes every tool away on its last step', () =>
  Effect.gen(function* () {
    const { run, step } = gate({ steps: 10 });
    const seen: string[] = [];
    for (let at = 0; at < 10; at += 1) {
      const directives = yield* step();
      seen.push(answerStep(directives) ? 'answer' : agentGuides(directives).length > 0 ? 'guide' : 'free');
      run.commitStep();
    }
    expect(seen).toEqual(['free', 'free', 'free', 'free', 'free', 'free', 'guide', 'free', 'free', 'answer']);
  }),
);

it.effect('the seconds budget takes every tool away once the run’s clock passes it', () =>
  Effect.gen(function* () {
    const { step } = gate({ seconds: 60 });
    expect(answerStep(yield* step())).toBe(false);
    yield* TestClock.adjust('61 seconds');
    expect(answerStep(yield* step())).toBe(true);
  }),
);

it.effect('a recovered run keeps the seconds it already spent', () =>
  Effect.gen(function* () {
    yield* TestClock.adjust('61 seconds');
    const { step } = gate({ seconds: 60 }, 0);
    expect(answerStep(yield* step())).toBe(true);
  }),
);
