import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { callServices, type CallServicesParams } from './declaration';

const tag = { path: 'workspace/places.ts', symbol: 'CallerWorkspace' };

const shape = (change: Partial<CallServicesParams> = {}): CallServicesParams => ({
  base: 'apps/tagma/server/src',
  region: ['composition/', 'invocation/'],
  files: { extensions: ['.ts'], exclude: [] },
  tags: [tag],
  allow: ['invocation/'],
  ...change,
});

const decodes = (change: object) => Result.isSuccess(Schema.decodeUnknownResult(callServices.params)({ ...shape(), ...change }));

describe('callServices parameters', () => {
  it('takes a tag only as one file and one exported name, each named once', () => {
    expect(decodes({ tags: [tag] })).toBe(true);
    expect(decodes({ tags: [{ ...tag, path: 'workspace/' }] })).toBe(false);
    expect(decodes({ tags: [{ ...tag, symbol: 'a.b' }] })).toBe(false);
    expect(decodes({ tags: [tag, tag] })).toBe(false);
    expect(decodes({ tags: [] })).toBe(false);
  });
});
