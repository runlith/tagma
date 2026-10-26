import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { generateObject } from './call';
import type { DecisionRequest } from './decision';
import { prepare, LlmClient } from './route/client';
import { type LLMEvent, Usage } from './schema/events';
import { Model, ModelIdentity } from './schema/options';
import { ModelID, ProviderID } from './schema/ids';
import * as AnthropicMessages from './protocols/anthropic-messages';
import { decideByText, type TextDecisionAnswering } from './textDecision';

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

const recorded =
  (events: readonly LLMEvent[]): TextDecisionAnswering =>
  (ask) =>
    generateObject({ model, system: ask.system, prompt: ask.prompt, jsonSchema: ask.jsonSchema }).pipe(
      Effect.map((answered) => ({
        object: answered.object,
        response: answered.response,
        model: new ModelIdentity({ provider: ProviderID.make('anthropic'), model: ModelID.make('claude-test') }),
      })),
      Effect.provideService(
        LlmClient,
        LlmClient.of({
          prepare: () => Effect.die('the decision reads a stream'),
          generate: () => Effect.die('the decision reads a stream'),
          stream: (request) => Stream.unwrap(Effect.as(prepare(request), Stream.fromIterable(events))),
        }),
      ),
    );

const answered = (input: unknown, reason: 'tool-calls' | 'content-filter' = 'tool-calls'): readonly LLMEvent[] => [
  { type: 'tool-call', id: 'call-1', name: 'generate_object', input },
  { type: 'finish', reason, usage: new Usage({ inputTokens: 120, outputTokens: 9 }) },
];

it.effect('a model without forced tool choice answers every question type as a verdict without probabilities', () =>
  Effect.gen(function* () {
    const answer = yield* decideByText(TRIAGE, recorded(answered({ addressed: true, kind: 'decision', urgency: '2' })));
    expect(answer.answers).toEqual({
      addressed: { type: 'noul', noul: true, probability: null },
      kind: { type: 'choice', choice: 'decision', probabilities: null, confidence: null },
      urgency: { type: 'score', score: 2, probabilities: null, confidence: null },
    });
    expect(answer.usage).toMatchObject({ inputTokens: 120, outputTokens: 9 });
  }),
);

it.effect('an answer outside the questions and a provider withholding one are refused by their reasons', () =>
  Effect.gen(function* () {
    const outside = yield* decideByText(TRIAGE, recorded(answered({ addressed: true, kind: 'escalate', urgency: '2' }))).pipe(Effect.flip);
    expect(outside).toMatchObject({ _tag: 'DecisionRefused', reason: 'malformed' });
    const withheld = yield* decideByText(TRIAGE, recorded(answered({}, 'content-filter'))).pipe(Effect.flip);
    expect(withheld).toMatchObject({ _tag: 'DecisionRefused', reason: 'provider-refused' });
  }),
);
