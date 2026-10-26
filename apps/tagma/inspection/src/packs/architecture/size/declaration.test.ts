import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { size } from './declaration';

describe('size: parameters', () => {
  it('refuses two thresholds of one glob and metric, and an empty list', () => {
    const one = { glob: '**', metric: 'non-import', lines: 10 };
    const attempt = (thresholds: readonly unknown[]) =>
      Schema.decodeUnknownExit(size.params)({ base: '', files: { extensions: ['.ts'], exclude: [] }, thresholds })._tag;
    expect([attempt([one]), attempt([one, { ...one, lines: 5 }]), attempt([])]).toEqual(['Success', 'Failure', 'Failure']);
  });
});
