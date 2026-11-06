import { expect, test } from 'bun:test';
import { EXECUTION_SETTING_KEYS, EXECUTION_SETTING_SECTIONS } from '../executions/testing/doubles.js';
import { SETTING_DECLARATIONS } from './testing/settings.js';

test('execution setting declarations of its own sections occupy one ordered span in the catalog', () => {
  const ids = SETTING_DECLARATIONS.keys.map((key) => key.id);
  const own = new Set(EXECUTION_SETTING_SECTIONS().map((section) => section.id));
  const expected = EXECUTION_SETTING_KEYS()
    .filter((key) => own.has(key.section))
    .map((key) => key.id);
  const start = ids.indexOf(expected[0]!);
  expect(start).toBeGreaterThan(0);
  expect(ids.slice(start, start + expected.length)).toEqual(expected);
  expect(EXECUTION_SETTING_KEYS().every((key) => ids.filter((candidate) => candidate === key.id).length === 1)).toBe(true);
});
