import { expect, test } from 'bun:test';
import { EXECUTION_SETTING_KEYS } from '../executions/testing/doubles.js';
import { SETTING_DECLARATIONS } from './settings.js';

test('execution setting declarations occupy one ordered span in the catalog', () => {
  const ids = SETTING_DECLARATIONS.keys.map((key) => key.id);
  const expected = EXECUTION_SETTING_KEYS().map((key) => key.id);
  const start = ids.indexOf(expected[0]!);
  expect(start).toBeGreaterThan(0);
  expect(ids.slice(start, start + expected.length)).toEqual(expected);
  expect(expected.every((id) => ids.filter((candidate) => candidate === id).length === 1)).toBe(true);
});
