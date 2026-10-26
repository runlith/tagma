import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { BUILTINS } from '../../../builtins';

const decodes = (change: object) =>
  Result.isSuccess(
    Schema.decodeUnknownResult(BUILTINS.loads.params)({
      base: 'app/src',
      from: ['core/'],
      refuses: ['@acme/client', 'heavy'],
      allows: ['@acme/client/models'],
      reads: 'static',
      conditions: [],
      files: { extensions: ['.ts'], exclude: [] },
      ...change,
    }),
  );

describe('loads parameters', () => {
  it('refuses a refusal no import could match, and an allowance no refusal covers', () => {
    expect(decodes({})).toBe(true);
    expect(decodes({ refuses: ['./heavy'] })).toBe(false);
    expect(decodes({ refuses: ['/abs/heavy'] })).toBe(false);
    expect(decodes({ allows: ['@acme/other'] })).toBe(false);
    expect(decodes({ allows: ['heavy'] })).toBe(false);
    expect(decodes({ allows: ['heavy/*'] })).toBe(true);
    expect(decodes({ refuses: ['heavy/*'], allows: ['heavy/*'] })).toBe(false);
    expect(decodes({ refuses: ['heavy/*'], allows: [] })).toBe(true);
    expect(decodes({ refuses: ['heavy*'], allows: [] })).toBe(false);
  });

  it('takes only what is judged and what is refused, and decodes the rest to its defaults', () => {
    expect(Schema.decodeUnknownSync(BUILTINS.loads.params)({ from: ['packages/domain'], refuses: ['react'] })).toEqual({
      base: '',
      from: ['packages/domain'],
      refuses: ['react'],
      allows: [],
      reads: 'runtime',
      conditions: [],
      files: { extensions: ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.svelte'], exclude: [] },
    });
  });
});
