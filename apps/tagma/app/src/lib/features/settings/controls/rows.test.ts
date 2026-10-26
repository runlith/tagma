import { describe, expect, test } from 'vitest';
import { Schema } from 'effect';
import { CompactionOverride, compactionOverrides } from '@tagma/server/native-harness/contract/wire/compactionSettings';
import { blankRow, fieldApplies, rowsToEdit, settleRow, writePath } from './rows.js';

const control = compactionOverrides.control;
const fields = control?.kind === 'rows' ? control.fields : [];
const decode = Schema.decodeUnknownSync(CompactionOverride);

describe('a list of records', () => {
  test('writes the fields that apply and drops the ones whose condition stopped holding', () => {
    const percent = settleRow(fields, { provider: 'devin-oauth', model: 'swe-2', strategy: 'percent', trigger: 0.4 });
    const reserved = settleRow(fields, {
      provider: 'devin-oauth',
      model: 'swe-2',
      strategy: 'reserve-output',
      trigger: 0.4,
    });
    expect(percent).toEqual({ provider: 'devin-oauth', model: 'swe-2', strategy: 'percent', trigger: 0.4 });
    expect(reserved).toEqual({ provider: 'devin-oauth', model: 'swe-2', strategy: 'reserve-output' });
  });

  test('what it settles is what the key decodes', () => {
    const rows = [
      { provider: 'openai-oauth', model: 'gpt-5.6-sol', strategy: 'percent', trigger: 0.7 },
      { provider: 'devin-oauth', model: 'gpt-5.6-sol', strategy: 'reserve-output' },
    ];
    for (const row of rows) {
      expect(() => decode(settleRow(fields, row))).not.toThrow();
    }
    expect(() => decode('{"provider":"devin-oauth","model":"swe-2"}')).toThrow();
    expect(decode({ provider: 'devin-oauth', model: 'swe-2', strategy: 'reserve-output', trigger: 0.4 })).toEqual({
      provider: 'devin-oauth',
      model: 'swe-2',
      strategy: 'reserve-output',
    });
  });

  test('a blank row carries the first answer of every declared choice and no model', () => {
    expect(blankRow(fields)).toEqual({ strategy: 'percent' });
  });

  test('a field applies only while its sibling says so', () => {
    const share = fields.find((field) => field.kind === 'share')!;
    expect(fieldApplies(share, { strategy: 'percent' })).toBe(true);
    expect(fieldApplies(share, { strategy: 'reserve-output' })).toBe(false);
  });

  test('editing opens on this layer’s rows, or on the ones it would replace', () => {
    const inherited = [{ provider: 'devin-oauth', model: 'swe-2', strategy: 'percent', trigger: 0.4 }];
    expect(rowsToEdit({ own: undefined, inherited, merging: true })).toEqual([]);
    expect(rowsToEdit({ own: undefined, inherited, merging: false })).toEqual(inherited);
    expect(rowsToEdit({ own: [], inherited, merging: true })).toEqual([]);
  });

  test('a write removes a property rather than storing an empty one', () => {
    const row = writePath({ provider: 'devin-oauth', trigger: 0.4 }, ['trigger'], undefined);
    expect(row).toEqual({ provider: 'devin-oauth' });
  });
});
