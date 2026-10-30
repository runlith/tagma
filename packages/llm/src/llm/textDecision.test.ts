import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { generateObject } from './call';
import type { DecisionRequest } from './decision';
import { prepare, LlmClient } from './route/client';
import { type LLMEvent, Usage } from './schema/events';
import { Model } from './schema/options';
import * as AnthropicMessages from './protocols/anthropic-messages';
import { decisionVerdicts, textDecisionAsk } from './textDecision';

const TRIAGE: DecisionRequest = {
  state: { thread: 'The agent asks the operator which of two migrations to keep.' },
  questions: {
    addressed: { type: 'noul', instructions: 'Does the text ask a person to act?' },
    kind: {
      type: 'choice',
      instructions: { ask: 'What does it want?' },
      criteria: { decision: 'A choice only a person makes.', report: null },
    },
    urgency: { type: 'score', instructions: 'How soon must a person act?', criteria: ['Whenever', 'Today', { level: 'Now' }] },
  },
};

const model = Model.make({
  id: 'claude-test',
  provider: 'anthropic',
  route: AnthropicMessages.route,
  compatibility: { toolChoice: ['auto', 'none'] },
});

const decided = (input: unknown) => {
  const ask = textDecisionAsk(TRIAGE);
  const events: readonly LLMEvent[] = [
    { type: 'tool-call', id: 'call-1', name: 'generate_object', input },
    { type: 'finish', reason: 'tool-calls', usage: new Usage({ inputTokens: 120, outputTokens: 9 }) },
  ];
  return generateObject({ model, system: ask.system, prompt: ask.prompt, jsonSchema: ask.jsonSchema }).pipe(
    Effect.flatMap((answered) => decisionVerdicts(TRIAGE, answered.object)),
    Effect.provideService(
      LlmClient,
      LlmClient.of({
        prepare: () => Effect.die('the decision reads a stream'),
        generate: () => Effect.die('the decision reads a stream'),
        stream: (request) => Stream.unwrap(Effect.as(prepare(request), Stream.fromIterable(events))),
      }),
    ),
  );
};

it.effect('a model without forced tool choice answers every question type as a verdict without probabilities', () =>
  Effect.gen(function* () {
    expect(yield* decided({ addressed: true, kind: 'decision', urgency: '2' })).toEqual({
      addressed: { type: 'noul', noul: true, probability: null },
      kind: { type: 'choice', choice: 'decision', probabilities: null, confidence: null },
      urgency: { type: 'score', score: 2, probabilities: null, confidence: null },
    });
  }),
);

it.effect('an answer outside the questions is refused as invalid output', () =>
  Effect.gen(function* () {
    expect(yield* decided({ addressed: true, kind: 'escalate', urgency: '2' }).pipe(Effect.flip)).toMatchObject({
      reason: { _tag: 'InvalidProviderOutput' },
    });
  }),
);
