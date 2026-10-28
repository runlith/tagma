import { expect, test } from 'vitest';
import { type ModelChoice, rankChoices } from './choice';

const row = (provider: string, providerLabel: string, model: string, label: string): ModelChoice => ({
  provider,
  providerLabel,
  model,
  label,
  short: '',
  ladder: [],
  rung: null,
});

const CHOICES = [
  row('openai-oauth', 'OpenAI OAuth', 'gpt-6-astra', 'GPT-6 Astra'),
  row('openai-oauth', 'OpenAI OAuth', 'gpt-5.6-sol', 'GPT-5.6 Sol'),
  row('openai-oauth', 'OpenAI OAuth', 'gpt-6-sol', 'GPT-6 Sol'),
  row('acme-oauth', 'Acme OAuth', 'acme-quark-1.3', 'Acme Quark 1.3'),
  row('opencode-go', 'OpenCode Go', 'deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'),
];

const labels = (query: string) => rankChoices(CHOICES, query).map((choice) => choice.label);

test('a query finds a model by the start of its name, by its initials and by its provider', () => {
  expect(labels('acm')).toEqual(['Acme Quark 1.3']);
  expect(labels('g6s')[0]).toBe('GPT-6 Sol');
  expect(labels('ds')).toEqual(['DeepSeek V4.1 Flash']);
  expect(labels('openai')).toEqual(['GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-6 Sol']);
});

test('a query puts the matching lead rows first in lead order, but neither past the exact name nor on a loose letter match', () => {
  const led = (query: string) =>
    rankChoices(CHOICES, query, ['openai-oauth:gpt-6-sol', 'acme-oauth:acme-quark-1.3']).map((choice) => choice.label);
  expect(led('gpt')).toEqual(['GPT-6 Sol', 'GPT-5.6 Sol', 'GPT-6 Astra']);
  expect(led('sol')).toEqual(['GPT-6 Sol', 'GPT-5.6 Sol']);
  expect(led('ek')).toEqual(['DeepSeek V4.1 Flash', 'Acme Quark 1.3']);
  const pair = [row('lab', 'Lab', 'sol-mini', 'Sol Mini'), row('lab', 'Lab', 'sol', 'Sol')];
  expect(rankChoices(pair, 'sol', ['lab:sol-mini']).map((choice) => choice.label)).toEqual(['Sol', 'Sol Mini']);
});

test('no query keeps every row in the order it was given', () => {
  expect(labels('  ')).toEqual(CHOICES.map((choice) => choice.label));
});
