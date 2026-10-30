import { modelCatalog } from '@runlith/llm/models/catalog';
import { expect, test } from 'vitest';
import { servedProvider } from '$lib/features/providers/testing.js';
import { choiceKey } from '$lib/shared/models/choice.js';
import { fieldModels } from './fieldModels.js';

const model = (capabilities: readonly ('text' | 'decision')[]) => ({
  label: capabilities.join(' '),
  short: capabilities.join(' '),
  capacity: { context: 200_000 },
  capabilities: [...capabilities],
  reasoning: ['low', 'high'],
  defaultReasoning: 'low',
});

const MODELS = modelCatalog([
  servedProvider({
    id: 'wire',
    models: { chat: model(['text']), judge: model(['decision']) },
    defaultTextModel: 'chat',
    asks: { chat: ['text', 'object', 'decision'], judge: ['decision'] },
  }),
  servedProvider({
    id: 'silent-cli',
    kind: 'harness',
    auth: 'cli',
    models: { coder: model(['text']) },
    defaultTextModel: 'coder',
  }),
]);

const keys = (ask: 'text' | 'decision') => fieldModels(MODELS, ask, null, []).choices.map((row) => choiceKey(row.provider, row.model));

test('a picker offers only the rows that answer its kind, models built for decisions first', () => {
  expect(keys('text')).toEqual(['wire:chat']);
  expect(keys('decision')).toEqual(['wire:judge', 'wire:chat']);
  expect(fieldModels(MODELS, 'decision', null, []).lead[0]).toMatchObject({ id: 'decision', keys: ['wire:judge'] });
});

test('the chosen row carries its rung and every other row the model default', () => {
  const rows = fieldModels(MODELS, 'decision', { provider: 'wire', model: 'chat', reasoning: 'high' }, []).choices;
  expect(rows.map((row) => [row.model, row.rung])).toEqual([
    ['judge', 'low'],
    ['chat', 'high'],
  ]);
});
