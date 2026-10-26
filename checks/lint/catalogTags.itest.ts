import { expect, test } from 'bun:test';
import { corpus, options } from './corpus';
import { compare } from './parity';

test('the real JSON wire keeps names literal units, counts, scope and every evidence line', () => {
  const result = compare(corpus, options, 'json');
  expect(result.occurrences).toBeGreaterThan(result.units);
  expect(new Set(result.findings.map((finding) => finding.fingerprint.split(' ').at(-1)))).toEqual(
    new Set(['compare', 'argument', 'property', 'lookup']),
  );
});

test('the real SARIF wire keeps the same units and counts without reading diagnostic messages', () => {
  const result = compare(corpus, options, 'sarif');
  expect(result.findings.find((finding) => finding.fingerprint === "literal graph/positions.ts 'task' compare")?.value).toBe(4);
  expect(result.findings.find((finding) => finding.fingerprint === "literal graph/catalog/allowed.ts 'task' compare")?.value).toBe(1);
});
