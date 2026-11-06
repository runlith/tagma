import { describe, expect, it } from 'bun:test';
import { catalogOf } from './catalog';
import type { Pack, Rule } from './rule';

const rule = (id: string, extra: Partial<Rule<unknown>> = {}) => ({ id, ...extra }) as unknown as Pack['rules'][number];

const facts = { languages: new Set<never>(), packages: new Set(['server']) };

describe('collecting packs', () => {
  it('refuses two packs declaring one rule, a required pack the composition lacks, a sliced rule that cannot bound or route its slices, and a calibrated rule with a static envelope', () => {
    expect(() =>
      catalogOf([
        { id: 'a', uses: {}, rules: [rule('x')] },
        { id: 'b', uses: {}, rules: [rule('x')] },
      ]),
    ).toThrow();
    expect(() => catalogOf([{ id: 'a', uses: {}, requires: ['base'], rules: [rule('x')] }])).toThrow();
    expect(() => catalogOf([{ id: 'a', uses: {}, rules: [rule('x', { sliced: true, envelope: { files: 1, mib: 1 } })] }])).toThrow();
    expect(() => catalogOf([{ id: 'a', uses: {}, rules: [rule('x', { sliced: true, relevant: () => true })] }])).toThrow();
    expect(() => catalogOf([{ id: 'a', uses: {}, rules: [rule('x', { calibrated: true, envelope: { files: 1, mib: 1 } })] }])).toThrow(
      'declares no static envelope',
    );
  });

  it('counts a pack used when a used pack requires it', () => {
    const shipped = catalogOf([
      { id: 'base', uses: { packages: ['nothing'] }, rules: [rule('x')] },
      { id: 'server', uses: { packages: ['server'] }, requires: ['base'], rules: [rule('y')] },
    ] as const satisfies readonly Pack[]);
    expect(shipped.used(facts)).toEqual(['base', 'server']);
  });
});
