import { expect, test } from 'bun:test';
import type { Measured } from '../../contract/wire/extensions.js';
import { Spend } from './spend.js';

const request = (input: number, cacheRead: number, cacheWrite: number, output: number): Measured => ({
  message: 'm',
  sentAt: '2026-10-18T00:00:00.000Z',
  input,
  cacheRead,
  cacheWrite,
  output,
  reasoning: 0,
  ttlSeconds: null,
});

const totals = (input: number, cacheRead: number, cacheWrite: number, output: number, cost: number) => ({
  total_cost_usd: cost,
  modelUsage: {
    model: {
      inputTokens: input,
      outputTokens: output,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheWrite,
      costBasis: 'managed',
    },
  },
});

test('a turn reports only what its requests did not, so requests and rest sum to the cumulative difference', () => {
  const spend = new Spend(true, () => {});
  const mark = spend.mark();
  spend.requested(request(1_000, 600, 300, 50));
  spend.record(totals(130, 700, 300, 90, 0.4));
  expect(spend.settled(mark)).toEqual({
    usage: { inputTokens: 130, outputTokens: 40, thoughtTokens: 0, cachedReadTokens: 100, cachedWriteTokens: 0, totalTokens: 170 },
    _meta: { 'tagma/cost': { amount: 0.4, currency: 'USD', basis: 'managed' } },
  });
});

test('requests that outgrow the cumulative difference leave no rest and say so', () => {
  const said: string[] = [];
  const spend = new Spend(true, (line) => void said.push(line));
  const mark = spend.mark();
  spend.requested(request(1_000, 0, 0, 50));
  spend.record(totals(900, 0, 0, 60, 0.1));
  expect(spend.settled(mark)).toEqual({ _meta: { 'tagma/cost': { amount: 0.1, currency: 'USD', basis: 'managed' } } });
  expect(said).toHaveLength(1);
});

test('an unreadable cumulative result claims neither rest nor cost', () => {
  const spend = new Spend(true, () => {});
  const mark = spend.mark();
  spend.requested(request(10, 0, 0, 2));
  spend.record({ total_cost_usd: 1, modelUsage: { model: { inputTokens: 27 } } });
  expect(spend.settled(mark)).toEqual({});
});
