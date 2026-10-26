import { describe, expect, test } from 'bun:test';
import { questionEntryId } from './entryNames';

describe('questionEntryId', () => {
  test('a separator inside a run or call id names no other question', () => {
    expect(questionEntryId('a', ['b', 'c'])).not.toBe(questionEntryId('a:b', ['c']));
    expect(questionEntryId('a', ['b:c'])).not.toBe(questionEntryId('a', ['b', 'c']));
  });

  test('one call id and two are different questions over the same run', () => {
    expect(questionEntryId('run-1', ['call-1'])).not.toBe(questionEntryId('run-1', ['call-1', 'call-2']));
  });
});
