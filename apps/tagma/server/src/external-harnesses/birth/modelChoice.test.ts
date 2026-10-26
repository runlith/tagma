import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { chosenModel, launchChoice, resolvedAsked } from './modelChoice.js';

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

it.effect('a saved model alias still launches with the canonical context and default reasoning after a catalog update', () =>
  Effect.gen(function* () {
    const canonical = 'composer-2.5@context=200k';
    const models = modelCatalog([
      {
        id: 'cursor',
        label: 'Cursor',
        auth: 'api-key',
        cacheLifetime: { promisedSeconds: null, prior: null },
        models: {
          [canonical]: {
            label: 'Composer',
            capabilities: ['text'],
            capacity: { context: 200000 },
            reasoning: ['high'],
            defaultReasoning: 'high',
            aliases: ['composer-2.5'],
          },
        },
        defaultTextModel: canonical,
      },
    ]);
    const saved = resolvedAsked(models, 'cursor', { model: 'composer-2.5', reasoning: null });
    expect(yield* launchChoice(models, 'cursor', saved, 'acp')).toEqual({ model: canonical, rung: 'high' });
  }),
);

test('a rung the model does not have is refused by name, with the rungs it does have', () => {
  const refused = chosenModel(MODELS, 'codex', { model: 'gpt-5.5', reasoning: 'max' });
  expect(refused._tag).toBe('Unavailable');
  if (refused._tag !== 'Unavailable') return;
  expect(refused.reason).toContain('gpt-5.5');
  expect(refused.reason).toContain('max');
  expect(refused.reason).toContain('low, medium, high, xhigh');
  expect(refused.unblock.join(' ')).toContain('xhigh');

  expect(chosenModel(MODELS, 'codex', { model: 'gpt-5.5', reasoning: 'xhigh' })).toEqual({
    _tag: 'Chosen',
    choice: { model: 'gpt-5.5', rung: 'xhigh' },
  });
});

test('a model the row does not serve, and a rung on a model that has none, are both refused', () => {
  const foreign = chosenModel(MODELS, 'claude-code', { model: 'claude-opus-4-5', reasoning: 'high' });
  expect(foreign._tag).toBe('Unavailable');
  if (foreign._tag === 'Unavailable') expect(foreign.reason).toContain('claude-opus-4-5');

  const rungless = chosenModel(MODELS, 'claude-code', { model: 'claude-haiku-4-5', reasoning: 'high' });
  expect(rungless._tag).toBe('Unavailable');

  expect(chosenModel(MODELS, 'claude-code', { model: 'claude-haiku-4-5', reasoning: null })).toEqual({
    _tag: 'Chosen',
    choice: { model: 'claude-haiku-4-5', rung: null },
  });
});

test('a row spelling one word takes the rung inside the id, and the pair is refused if it has none', () => {
  expect(chosenModel(MODELS, 'devin', { model: 'gpt-5.6-sol', reasoning: 'high' })).toEqual({
    _tag: 'Chosen',
    choice: { model: 'gpt-5-6-sol-high', rung: null },
  });
  expect(chosenModel(MODELS, 'devin', { model: 'gpt-5.6-sol', reasoning: 'ultra' })._tag).toBe('Unavailable');
  expect(chosenModel(MODELS, 'grok', { model: 'grok-4.6', reasoning: 'high' })._tag).toBe('Unavailable');
  expect(chosenModel(MODELS, 'claude-code', undefined)).toEqual({ _tag: 'None' });
});

it.effect('a stored model the row no longer serves fails the launch as a typed refusal, and a served one answers its choice', () =>
  Effect.gen(function* () {
    const refused = yield* Effect.result(launchChoice(MODELS, 'claude-code', { model: 'claude-opus-4-5', reasoning: 'high' }));
    expect(refused._tag).toBe('Failure');
    if (refused._tag === 'Failure') expect(refused.failure.code).toBe('model-unavailable');

    expect(yield* launchChoice(MODELS, 'claude-code', { model: 'claude-haiku-4-5', reasoning: null })).toEqual({
      model: 'claude-haiku-4-5',
      rung: null,
    });
    expect(yield* launchChoice(MODELS, 'claude-code', undefined)).toBeUndefined();
  }),
);
