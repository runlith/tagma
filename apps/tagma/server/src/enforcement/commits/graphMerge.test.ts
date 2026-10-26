import { expect, test } from 'bun:test';
import { debtMerged } from './graphMerge.js';

const held = { base: 'a'.repeat(40), path: 'src/core/shared.ts' };

test('a held debt entry both sides keep stays held through the merge of the debt', () => {
  const entry = { fingerprint: 'F4 src/core/shared.ts', owner: 'task', count: 2, held };
  expect(debtMerged([entry], [{ ...entry, count: 1 }], [entry])).toEqual([{ ...entry, count: undefined }]);
});
