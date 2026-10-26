import { expect, test } from 'bun:test';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { operationGateAt } from './refusals.js';

test('the invocation boundary passes typed gate refusals and does not classify store failures by operation id', () => {
  const gate = new GateRefusal('terminal-not-holder', 'another holder', ['ask the holder']);
  const store = new EffectDrizzleQueryError({ query: 'select', params: [], cause: new Error('store closed') });
  expect(operationGateAt(gate)).toBe(gate);
  expect(operationGateAt(store)).toBeNull();
});
