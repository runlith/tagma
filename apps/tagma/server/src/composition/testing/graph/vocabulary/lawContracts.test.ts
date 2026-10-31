import { expect, test } from 'bun:test';
import type { Declaration } from '../../../../graph/contract/wire/tags/declaration.js';
import { ENFORCED, LAW } from '../../../../graph/contract/wire/tags/lawContracts.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';

const enforcement = { type: 'schema', name: 'lawEnforcement' } as const;
const unread = (declaration: Declaration) => new TagIndex([declaration], BEHAVIOUR_REGISTRY).unreadable.map((entry) => entry.id);
const rule = (fields: Declaration['fields'], contracts: NonNullable<Declaration['contracts']>): Declaration => ({
  id: 'statute',
  fields,
  contracts,
  prompt: '',
});
const switchOn = { slots: { enabled: 'live' }, words: {} };
const document = { slots: { enforcement: 'verdict' }, words: {} };

test('the enforcement-registered law contracts bind a switch of any type and a lawEnforcement document, and an enforced binding needs law', () => {
  expect(unread(rule({ live: 'boolean', verdict: enforcement }, { [LAW]: switchOn, [ENFORCED]: document }))).toEqual([]);
  expect(unread(rule({ live: 'string' }, { [LAW]: switchOn }))).toEqual([]);
  expect(unread(rule({ live: 'boolean', verdict: 'string' }, { [LAW]: switchOn, [ENFORCED]: document }))).toEqual(['statute']);
  expect(unread(rule({ verdict: enforcement }, { [ENFORCED]: document }))).toEqual(['statute']);
});

test('a law binds delivery only to an enum of exactly prompt and code', () => {
  const delivered = (values: readonly [string, ...string[]]) =>
    unread(
      rule({ live: 'boolean', reach: { type: 'enum', values } }, { [LAW]: { slots: { enabled: 'live', delivery: 'reach' }, words: {} } }),
    );
  expect(delivered(['code', 'prompt'])).toEqual([]);
  expect(delivered(['prompt', 'code', 'both'])).toEqual(['statute']);
});
