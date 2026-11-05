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
  const evaluate = (facts: Record<string, unknown>, at: number) =>
    policy.evaluate({ thread, run, runId: 'run-1', invocationKey: `at:${at}`, ordinal: at + 1, ...facts } as never);
  const step = () => evaluate({ hook: 'beforeStep', modelMessages: [] }, run.stepNumber);
  const close = (answering: boolean) =>
    evaluate({ hook: 'beforeClose', modelMessages: [], steps: [], catalog: answering ? { answer: {} } : {} }, 0);
  return { run, step, close };
};

const forced = (directives: readonly AgentDirective[]) => ({
  restrict: directives.flatMap((directive) => (directive.type === 'restrict' ? [directive.tools] : [])),
  require: directives.flatMap((directive) => (directive.type === 'require' ? [directive.tool] : [])),
});

it.effect('a thread whose definition sets no budget is never gated', () =>
  Effect.gen(function* () {
    const { run, step } = gate(undefined);
    for (let at = 0; at < 3; at += 1) {
      expect(yield* step()).toEqual([]);
      run.commitStep();
    }
  }),
);

it.effect('the steps budget guides once at 70% and forces the answer on its last step', () =>
  Effect.gen(function* () {
    const { run, step } = gate({ steps: 10 });
    const seen: string[] = [];
    for (let at = 0; at < 10; at += 1) {
      const directives = yield* step();
      seen.push(forced(directives).require.length > 0 ? 'forced' : agentGuides(directives).length > 0 ? 'guide' : 'free');
      run.commitStep();
    }
    expect(seen).toEqual(['free', 'free', 'free', 'free', 'free', 'free', 'guide', 'free', 'free', 'forced']);
  }),
);

it.effect('the seconds budget forces the answer once the run’s clock passes it', () =>
  Effect.gen(function* () {
    const { step } = gate({ seconds: 60 });
    expect(forced(yield* step()).require).toEqual([]);
    yield* TestClock.adjust('61 seconds');
    expect(forced(yield* step())).toEqual({ restrict: [['answer']], require: ['answer'] });
  }),
);

it.effect('a recovered run keeps the seconds it already spent', () =>
  Effect.gen(function* () {
    yield* TestClock.adjust('61 seconds');
    const { step } = gate({ seconds: 60 }, 0);
    expect(forced(yield* step())).toEqual({ restrict: [['answer']], require: ['answer'] });
  }),
);

it.effect('a text-only reply to the forced answer step ends the run without another step', () =>
  Effect.gen(function* () {
    const { run, step, close } = gate({ steps: 2 });
    yield* step();
    run.commitStep();
    expect(forced(yield* step()).require).toEqual(['answer']);
    expect(agentGuides(yield* close(true))).toEqual([]);
  }),
);

it.effect('a text-only finish without answer is asked once to call it, then taken as the answer', () =>
  Effect.gen(function* () {
    const { step, close } = gate({ steps: 25 });
    yield* step();
    expect(agentGuides(yield* close(false))).toEqual([]);
    expect(agentGuides(yield* close(true))).toHaveLength(1);
    expect(forced(yield* step()).require).toEqual(['answer']);
    expect(agentGuides(yield* close(true))).toEqual([]);
  }),
);
