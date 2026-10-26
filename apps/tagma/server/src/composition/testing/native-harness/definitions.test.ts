import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { DECLARATIONS } from '../../../native-harness/testing/doubles.js';
import { servedCapabilities } from './capabilities.js';

it.effect('each built-in declaration derives its rules, floor and grant from exactly the capabilities it declares', () =>
  Effect.map(servedCapabilities(), (definitions) => {
    for (const declaration of DECLARATIONS()) {
      const effective = definitions.effective(declaration);
      const declared = effective.declared;
      const ids = declared.map((capability) => capability.id);
      const joined = definitions
        .list()
        .filter((capability) => capability.joins?.includes(declaration.id) === true && !declaration.capabilities.includes(capability.id))
        .map((capability) => capability.id);
      if (declaration.id !== 'declared') expect(ids).toEqual([...declaration.capabilities, ...joined]);
      else expect(new Set(ids)).toEqual(new Set(definitions.list().map((capability) => capability.id)));

      const ruleIds = new Set(definitions.rules(declaration, () => undefined).map((rule) => rule.id));
      const ruleIdsOf = new Set(declared.flatMap((capability) => (capability.rules ?? []).map((rule) => rule.id)));
      expect(ruleIds).toEqual(ruleIdsOf);

      const sources = new Set(effective.grant.sources.map((source) => source.source));
      expect(sources.has(declaration.id)).toBe(true);
      for (const own of declaration.sources) expect(sources.has(own)).toBe(true);
      for (const source of declared.flatMap((capability) => capability.runtimeSources ?? [])) expect(sources.has(source)).toBe(true);
    }
  }),
);

it.effect('the collaboration source keeps the final answer standing however the grant narrows it', () =>
  Effect.map(servedCapabilities(), (definitions) => {
    const tagma = DECLARATIONS().find((declaration) => declaration.id === 'tagma')!;
    expect(definitions.effective(tagma).grant.sources.find((source) => source.source === 'collaboration')).toEqual({
      source: 'collaboration',
      narrowable: true,
      standing: ['send_message', 'read_models'],
    });
  }),
);

it.effect('an overlay narrows what a thread holds without changing what the declaration grants', () =>
  Effect.map(servedCapabilities(), (definitions) => {
    const tagma = DECLARATIONS().find((declaration) => declaration.id === 'tagma')!;
    const narrowed = definitions.effective(tagma, { id: 'p', baseAgentId: 'tagma', description: '', capabilities: ['files'], prompt: 'P' });
    expect(narrowed.held.map((capability) => capability.id)).toEqual(['files']);
    expect(narrowed.identity).toBe('P');
    expect(narrowed.grant).toEqual(definitions.effective(tagma).grant);
  }),
);
