import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { ABSENCE_FORMS, swallowedFailures, type SwallowedFailuresParams } from './declaration';

const one = { path: 'packages/a/x.ts', symbol: 'release', form: 'ignore' as const, site: '0000abcd', why: 'cleanup' };

const shape = (change: Partial<SwallowedFailuresParams> = {}): SwallowedFailuresParams => ({
  base: '',
  region: ['apps/tagma/server/src/', 'packages/'],
  files: { extensions: ['.ts'], exclude: ['**/*.test.*'] },
  allow: [],
  ...change,
});

const decodes = (change: object) => Result.isSuccess(Schema.decodeUnknownResult(swallowedFailures.params)({ ...shape(), ...change }));

describe('swallowedFailures parameters', () => {
  it('takes an allowance only for one exact file, symbol, form and site, with its reason', () => {
    expect(decodes({ allow: [one] })).toBe(true);
    expect(decodes({ allow: [{ ...one, path: 'packages/a/' }] })).toBe(false);
    expect(decodes({ allow: [{ ...one, path: 'packages/a/*.ts' }] })).toBe(false);
    expect(decodes({ allow: [{ ...one, site: 'abc' }] })).toBe(false);
    expect(decodes({ allow: [{ ...one, why: '' }] })).toBe(false);
    expect(decodes({ allow: [one, one] })).toBe(false);
    for (const form of ABSENCE_FORMS) {
      expect(decodes({ allow: [{ ...one, form }] })).toBe(true);
      expect(decodes({ allow: [{ ...one, form, why: '' }] })).toBe(false);
    }
  });
});
