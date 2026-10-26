import { expect } from 'bun:test';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { it } from '@runlith/effect-test';
import type { DecisionRequest } from '@runlith/llm/decision';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { AuthenticationReason, LLMError } from '@runlith/llm/schema/errors';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Effect, Layer, Schema, Stream } from 'effect';
import { AccountCredentials, ModelAccess } from '../providers/contract/service/access.js';
import { DecisionModels } from '../providers/contract/service/decisions.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { providerCatalogOf, staticRegistry, testRegistry } from '../providers/testing/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { HarnessRegistry } from './contract/service/harness.js';
import { ThreadLookup } from './contract/service/reads.js';
import { makeThreadDecisions } from './decisions.js';
import type { ThreadMetadata } from './list/store.js';
import { makeRoads } from './roads.js';

const TRIAGE: DecisionRequest = {
  state: { thread: 'The agent asks the operator which of two migrations to keep.' },
  questions: {
    addressed: { type: 'noul', instructions: 'Does the text ask a person to act?' },
    kind: {
      type: 'choice',
      instructions: 'What does it want?',
      criteria: { decision: 'A choice only a person makes.', report: 'Nothing.' },
    },
    urgency: { type: 'score', instructions: 'How soon must a person act?', criteria: ['Whenever', 'Today', 'Now'] },
  },
};

const provider = testRegistry.current().models.named('test-provider');
const catalog = providerCatalogOf([
  {
    ...provider,
    id: 'text',
    models: {
      large: {
        label: 'Large',
        capacity: { context: 64_000 },
        capabilities: ['text'],
        reasoning: ['low', 'medium'],
        defaultReasoning: 'medium',
      },
      light: { label: 'Light', capacity: { context: 16_000 }, capabilities: ['text'], reasoning: ['low'], defaultReasoning: 'low' },
    },
    defaultTextModel: 'large',
    lightTextModel: { model: 'light', rung: 'low' },
  },
  {
    ...provider,
    id: 'native',
    models: {
      judge: { label: 'Judge', capacity: { context: 64_000 }, capabilities: ['text', 'decision'], reasoning: [], defaultReasoning: null },
    },
    defaultTextModel: 'judge',
  },
]);

const setup = Effect.gen(function* () {
  const storage = yield* openMemoryStorage();
  const row = yield* storage.aggregate.insert({
    ownerId: 'operator',
    agentId: 'tagma',
    provider: 'text',
    model: 'large',
    reasoning: 'medium',
  });
  const thread: ThreadMetadata = { ...row, projectId: 1, scopeBlockUuid: null, harness: null };
  const values = new Map<string, unknown>();
  const connected = new Set<string>();
  const said = { object: { addressed: true, kind: 'decision', urgency: '2' } as unknown };
  const recording = activityRecording();
  const context = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(HarnessRegistry, {
        list: () => {
          throw new Error('Native decisions do not list harnesses');
        },
        writes: () => {
          throw new Error('Native decisions do not ask for harness writes');
        },
      }),
      Layer.mock(Settings, {
        value: (key) => Schema.decodeUnknownEffect(key.schema)(values.get(key.id) ?? key.fallback).pipe(Effect.orDie),
      }),
      Layer.mock(ThreadLookup, { find: () => Effect.succeed(thread) }),
      Layer.succeed(ProviderRegistry, staticRegistry(catalog)),
      Layer.succeed(
        AccountCredentials,
        AccountCredentials.of({
          account: (provider) =>
            connected.has(provider)
              ? Effect.succeed(AccountKey.make(`account-${provider}`))
              : Effect.fail(
                  new LLMError({
                    module: 'test',
                    method: 'account',
                    reason: new AuthenticationReason({ message: 'No connected account.', kind: 'missing' }),
                  }),
                ),
        }),
      ),
      Layer.succeed(ActivityLog, recording.log),
      Layer.succeed(
        ModelAccess,
        ModelAccess.of({
          defaultModel: (provider) => catalog.models.defaultTextModelId(provider),
          served: (provider, model) =>
            Effect.sync(() => {
              const option = catalog.models.resolveTextModel(provider, model);
              return {
                id: option.id,
                capacity: option.capacity ?? { context: 64_000 },
                cacheLifetime: { promisedSeconds: null, prior: null },
                requestLimits: undefined,
                compactionTrigger: undefined,
              };
            }),
          request: () => ({
            plannedOutputTokens: 32,
            text: () => Effect.die('The decision fixture answers objects only'),
            stream: () => Stream.die('The decision fixture answers objects only'),
            object: <T>() =>
              Effect.succeed({
                object: said.object as T,
                response: new LLMResponse({
                  message: Message.assistant(''),
                  events: [],
                  usage: new Usage({ inputTokens: 120, outputTokens: 9 }),
                  finishReason: 'tool-calls',
                }),
              }),
          }),
        }),
      ),
      Layer.succeed(
        DecisionModels,
        DecisionModels.of({
          decide: (call) =>
            Effect.succeed({
              model: new ModelIdentity({ provider: ProviderID.make(call.provider), model: ModelID.make(call.model) }),
              answers: {
                addressed: { type: 'noul', noul: true, probability: 0.93 },
                kind: { type: 'choice', choice: 'decision', probabilities: { decision: 0.88, report: 0.12 }, confidence: 0.8 },
                urgency: { type: 'score', score: 1.7, probabilities: { '0': 0.05, '1': 0.2, '2': 0.75 }, confidence: 0.7 },
              },
              usage: new Usage({ inputTokens: 300, outputTokens: 0 }),
            }),
        }),
      ),
    ),
  );
  const roads = yield* makeRoads.pipe(Effect.provide(context));
  const decisions = yield* makeThreadDecisions({ idleMs: 1000, roads }).pipe(Effect.provide(context));
  return { thread, values, connected, said, recording, decisions };
});

it.effect('answers on the decision chain, normalizes text answers and records the chosen road and usage', () =>
  Effect.gen(function* () {
    const { thread, values, connected, said, recording, decisions } = yield* setup;
    expect(yield* decisions.decide(thread.id, TRIAGE)).toMatchObject({
      road: 'thread-model',
      model: { provider: 'text', model: 'large' },
      answers: {
        addressed: { type: 'noul', noul: true, probability: null },
        kind: { type: 'choice', choice: 'decision', probabilities: null, confidence: null },
        urgency: { type: 'score', score: 2, probabilities: null, confidence: null },
      },
      usage: { inputTokens: 120, outputTokens: 9 },
    });
    connected.add('text');
    expect(yield* decisions.decide(thread.id, TRIAGE)).toMatchObject({
      road: 'provider-light',
      model: { provider: 'text', model: 'light' },
    });
    values.set('threads.decisionModel', 'text:large');
    values.set('threads.decisionReasoning', 'medium');
    expect(yield* decisions.decide(thread.id, TRIAGE)).toMatchObject({
      road: 'decision-model',
      model: { provider: 'text', model: 'large' },
    });
    said.object = { addressed: 'maybe', kind: 'decision', urgency: '2' };
    expect(yield* decisions.decide(thread.id, TRIAGE).pipe(Effect.flip)).toMatchObject({ _tag: 'DecisionRefused', reason: 'malformed' });
    values.set('threads.decisionModel', 'text:missing');
    expect(yield* decisions.decide(thread.id, TRIAGE).pipe(Effect.flip)).toMatchObject({ _tag: 'DecisionRefused', reason: 'no-model' });
    const recorded = recording.activities();
    expect(recorded.flatMap((row) => row.notes)).toContainEqual(
      expect.objectContaining({
        type: 'model-chosen',
        road: 'thread-model',
        rejected: expect.arrayContaining([
          { road: 'decision-model', reason: 'not-configured' },
          { road: 'provider-light', reason: 'account-unavailable' },
          { road: 'cli', reason: 'no-schema' },
        ]),
      }),
    );
    expect(recorded.map((row) => row.ended?.result)).toContainEqual(
      expect.objectContaining({ road: 'thread-model', usage: expect.objectContaining({ inputTokens: 120, outputTokens: 9 }) }),
    );
    expect(recorded.flatMap((row) => row.notes)).toContainEqual(
      expect.objectContaining({ type: 'model-chosen', road: 'decision-model', rung: 'medium' }),
    );
  }),
);

it.effect('a connected decision-capable model answers natively with its computed probabilities', () =>
  Effect.gen(function* () {
    const { thread, connected, decisions } = yield* setup;
    connected.add('native');
    expect(yield* decisions.decide(thread.id, TRIAGE)).toMatchObject({
      road: 'decision-capable',
      model: { provider: 'native', model: 'judge' },
      answers: {
        addressed: { type: 'noul', noul: true, probability: 0.93 },
        kind: { type: 'choice', choice: 'decision', probabilities: { decision: 0.88, report: 0.12 }, confidence: 0.8 },
        urgency: { type: 'score', score: 1.7, confidence: 0.7 },
      },
      usage: { inputTokens: 300, outputTokens: 0 },
    });
  }),
);
