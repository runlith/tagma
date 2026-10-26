import { expect, test } from 'bun:test';
import { devin } from './row.js';

const atif = (session_id: unknown): string =>
  JSON.stringify({ schema_version: 'ATIF-v1.7', session_id, agent: { model_name: 'SWE-2 Max' } });

test('the devin witness reads its export session id and nothing else', () => {
  const witness = devin.launch.witness!;
  expect(witness(atif('foremost-boot'))).toBe('foremost-boot');
  expect(witness(atif('  foremost-boot  '))).toBe('foremost-boot');
  expect(witness(atif(null))).toBeNull();
  expect(witness(atif(''))).toBeNull();
  expect(witness(atif('   '))).toBeNull();
  expect(witness(atif(42))).toBeNull();
  expect(witness(JSON.stringify({ schema_version: 'ATIF-v1.7' }))).toBeNull();
  expect(witness('not json')).toBeNull();
  expect(witness('')).toBeNull();
});
