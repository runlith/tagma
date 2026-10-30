import { expect } from 'bun:test';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { it } from '@runlith/effect-test';
import type { DecisionRequest } from '@runlith/llm/decision';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import type { HarnessProvider, WireProvider } from '@runlith/tagma/adapter/provider';
import { Effect, Layer, Stream } from 'effect';
import { ProviderAccounts } from './contract/service/accounts.js';
import { ModelAccess } from './contract/service/access.js';
import { AskPrograms, DefaultSelection, type SavedSelection } from './contract/service/asks.js';
import { AdapterInstalls } from './contract/service/adapters.js';
import { noInstalls } from './testing/holders.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { ProviderRegistry } from './contract/service/registry.js';
import { makeModelAsks } from './asks.js';
import { providerCatalogOf, staticRegistry, testRegistry } from './testing/registry.js';

const TRIAGE: DecisionRequest = {
  state: { thread: 'The agent asks the operator which of two migrations to keep.' },
  questions: {
    addressed: { type: 'noul', instructions: 'Does the text ask a person to act?' },
    urgency: { type: 'score', instructions: 'How soon must a person act?', criteria: ['Whenever', 'Today', 'Now'] },
  },
};

const wire = testRegistry.current().models.named('test-provider') as WireProvider;

const catalog = providerCatalogOf([
  {
    ...wire,
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
    ...wire,
    id: 'native',
    models: {
      judge: { label: 'Judge', capacity: { context: 64_000 }, capabilities: ['text', 'decision'], reasoning: [], defaultReasoning: null },
    },
    defaultTextModel: 'judge',
  },
  {
    ...wire,
    id: 'chat',
    models: { luna: { label: 'Luna', capacity: { context: 64_000 }, capabilities: ['text'], reasoning: ['low'], defaultReasoning: 'low' } },
    defaultTextModel: 'luna',
    borrows: { provider: 'codex', read: () => Effect.succeed(null) },
  },
  {
    id: 'codex',
    label: 'Codex',
    kind: 'harness',
    auth: 'cli',
    models: { luna: { label: 'Luna', capacity: { context: 64_000 }, capabilities: ['text'], reasoning: ['low'], defaultReasoning: 'low' } },
    defaultTextModel: 'luna',
    lightTextModel: { model: 'luna', rung: 'low' },
    cacheLifetime: { promisedSeconds: null, prior: null },
    environment: () => [],
  } satisfies HarnessProvider,
]);

const setup = Effect.gen(function* () {
  const connected = new Set<string>();
  const saved: { selection: SavedSelection | null } = { selection: null };
  const said = { object: { addressed: true, urgency: '2' } as unknown, requested: [] as string[] };
  const recording = activityRecording();
  const response = new LLMResponse({
    message: Message.assistant('answer'),
    events: [{ type: 'text-delta', id: 'answer', text: 'answer' }],
    usage: new Usage({ inputTokens: 120, outputTokens: 9 }),
    finishReason: 'stop',
  });
  const context = yield* Layer.build(
    Layer.mergeAll(
      Layer.succeed(ProviderRegistry, staticRegistry(catalog)),
      Layer.mock(ProviderAccounts, { connected: Effect.sync(() => ({ revision: 0, providers: new Set(connected) })) }),
      Layer.mock(HarnessAccounts, { launch: () => Effect.succeed(null) }),
      Layer.mock(AskPrograms, { run: () => Effect.die('no program answers in this catalog') }),
      Layer.succeed(AdapterInstalls, noInstalls),
      Layer.succeed(DefaultSelection, DefaultSelection.of({ saved: Effect.sync(() => saved.selection) })),
      Layer.succeed(ActivityLog, recording.log),
      Layer.succeed(
        ModelAccess,
        ModelAccess.of({
          defaultModel: (provider) => catalog.models.defaultTextModelId(provider),
          served: (provider, model) =>
            Effect.sync(() => ({
              id: model ?? '',
              capacity: catalog.models.resolveTextModel(provider, model).capacity ?? { context: 64_000 },
              cacheLifetime: { promisedSeconds: null, prior: null },
              requestLimits: undefined,
              compactionTrigger: undefined,
            })),
          request: (input) => {
            said.requested.push(`${input.provider}:${input.model}`);
            return {
              plannedOutputTokens: 32,
              text: () => Effect.succeed(response),
              stream: () => Stream.die('asks do not stream'),
              object: <T>() => Effect.succeed({ object: said.object as T, response }),
            };
          },
          decide: (call) =>
            Effect.succeed({
              model: new ModelIdentity({ provider: ProviderID.make(call.provider), model: ModelID.make(call.model) }),
              answers: {
                addressed: { type: 'noul', noul: true, probability: 0.93 },
                urgency: { type: 'score', score: 1.7, probabilities: { '0': 0.05, '1': 0.2, '2': 0.75 }, confidence: 0.7 },
              },
              usage: new Usage({ inputTokens: 300, outputTokens: 0 }),
            }),
        }),
      ),
    ),
  );
  const asks = yield* makeModelAsks.pipe(Effect.provide(context));
  return { asks, connected, saved, said, recording };
});

it.effect(
  'an empty role picks a decision model, then the asker’s light model and own model, then the saved default, each only when connected',
  () =>
    Effect.gen(function* () {
      const { asks, connected, saved } = yield* setup;
      const empty = null;
      const asker = { provider: 'text', model: 'large', account: null };
      expect(yield* asks.choose('text', empty, asker).pipe(Effect.flip)).toMatchObject({ _tag: 'AskRefused', refusal: 'ask-unanswerable' });
      connected.add('native');
      expect(yield* asks.choose('decision', empty, asker)).toEqual({ provider: 'native', model: 'judge', reasoning: null, account: null });
      expect(yield* asks.choose('text', empty, { provider: 'native', model: 'judge', account: 'key' })).toEqual({
        provider: 'native',
        model: 'judge',
        reasoning: null,
        account: 'key',
      });
      connected.add('text');
      expect(yield* asks.choose('text', empty, asker)).toEqual({ provider: 'text', model: 'light', reasoning: 'low', account: null });
      saved.selection = { provider: 'text', model: 'large' };
      expect(yield* asks.choose('text', empty)).toMatchObject({ provider: 'text', model: 'light' });
    }),
);

it.effect('with only a borrowed CLI login connected, the default is the borrowing subscription’s light model', () =>
  Effect.gen(function* () {
    const { asks, connected, said } = yield* setup;
    connected.add('codex');
    const chosen = yield* asks.choose('text', null);
    expect(chosen).toEqual({ provider: 'codex', model: 'luna', reasoning: 'low', account: null });
    expect(yield* asks.text(chosen, { system: 'Name it.', input: 'words' })).toMatchObject({ value: 'answer', path: 'request' });
    expect(said.requested).toEqual(['chat:luna']);
  }),
);

it.effect('a decision answers by its profile on a decision model and by a checked object answer elsewhere', () =>
  Effect.gen(function* () {
    const { asks, said, recording } = yield* setup;
    const judged = yield* asks.decide({ provider: 'native', model: 'judge', reasoning: null, account: null }, TRIAGE);
    expect(judged.value.answers.addressed).toEqual({ type: 'noul', noul: true, probability: 0.93 });
    const text = yield* asks.decide({ provider: 'text', model: 'large', reasoning: 'medium', account: null }, TRIAGE);
    expect(text.value.answers).toEqual({
      addressed: { type: 'noul', noul: true, probability: null },
      urgency: { type: 'score', score: 2, probabilities: null, confidence: null },
    });
    said.object = { addressed: 'maybe', urgency: '2' };
    expect(
      yield* asks.decide({ provider: 'text', model: 'large', reasoning: 'medium', account: null }, TRIAGE).pipe(Effect.flip),
    ).toMatchObject({ refusal: 'ask-unreadable-answer' });
    expect(yield* asks.choose('decision', { provider: 'text', model: 'missing' }).pipe(Effect.flip)).toMatchObject({
      refusal: 'ask-unanswerable',
    });
    expect(
      recording
        .activities()
        .filter((row) => row.opened.kind === 'ask')
        .map((row) => row.ended?.result),
    ).toContainEqual(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 300 }) }));
  }),
);
