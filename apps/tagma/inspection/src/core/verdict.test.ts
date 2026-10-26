import { expect, test } from 'bun:test';
import { newViolations, siteRows, unitsOf, valuedDuplicate, type Violation } from './verdict';

const at = (fingerprint: string, line: number, value?: number) => ({
  fingerprint,
  file: 'a.ts',
  line,
  value,
});
const times = (fingerprint: string, count: number) => Array.from({ length: count }, (_, line) => at(fingerprint, line + 1));
const fresh = <V extends Violation>(
  built: readonly V[],
  base: readonly V[],
  debt: Parameters<typeof newViolations>[2],
  how: Parameters<typeof newViolations>[3] = {},
) => newViolations(built, base, debt, how).violations;

test('base 2 with debt 2 lets a built 3 through as one new, never as four allowed', () => {
  expect(fresh(times('f', 3), times('f', 2), [{ fingerprint: 'f', count: 2 }])).toHaveLength(1);
});

test('a base lowered to 1 and a later change back to 2 is one new', () => {
  expect(fresh(times('f', 1), times('f', 2), [{ fingerprint: 'f', count: 2 }])).toEqual([]);
  expect(fresh(times('f', 2), times('f', 1), [{ fingerprint: 'f', count: 2 }])).toHaveLength(1);
});

test('debt 3 with base 1 and built 2 is one new: the base is the allowance, the debt is not consulted', () => {
  expect(fresh(times('f', 2), times('f', 1), [{ fingerprint: 'f', count: 3 }])).toHaveLength(1);
});

test('the debt count is the allowance where the base holds no such key', () => {
  expect(fresh(times('f', 3), [], [{ fingerprint: 'f', count: 3 }])).toEqual([]);
  expect(fresh(times('f', 4), [], [{ fingerprint: 'f', count: 3 }])).toHaveLength(1);
  expect(fresh(times('f', 2), [], ['f'])).toHaveLength(1);
});

test('a base reading covering the key path leaves the debt unconsulted: debt 3, base now 0, built 1 is one new', () => {
  const covers = (file: string) => file === 'a.ts';
  expect(fresh(times('f', 1), [], [{ fingerprint: 'f', count: 3 }], { covers })).toHaveLength(1);
  expect(fresh(times('f', 1), [], [{ fingerprint: 'f', count: 3 }], { covers: () => false })).toEqual([]);
});

test('a measured value never makes a standing key new, whichever way it moves', () => {
  expect(fresh([at('f', 1, 6)], [at('f', 1, 5)], [{ fingerprint: 'f' }])).toEqual([]);
  expect(fresh([at('f', 1, 6)], [], [{ fingerprint: 'f' }])).toEqual([]);
  expect(fresh([at('f', 1, 4)], [at('f', 1, 5)], [])).toEqual([]);
  expect(fresh([at('g', 1, 6)], [at('f', 1, 5)], [{ fingerprint: 'f' }])).toHaveLength(1);
});

test('a key over its base count answers every occurrence of it, so a caller can pick the touched ones', () => {
  const answered = newViolations(times('f', 3), times('f', 1), []);
  expect(answered.violations.map(({ line }) => line)).toEqual([2, 3]);
  expect(answered.occurrences.map(({ line }) => line)).toEqual([1, 2, 3]);
  expect(newViolations(times('f', 2), [], []).occurrences).toEqual([]);
});

test('an owner groups the sites of one declared unit: the arithmetic counts the unit once and flattening restores every site in order', () => {
  const sites = [at('f', 5), at('g', 1), at('f', 2)];
  const units = unitsOf(sites);
  expect(units.map(({ fingerprint, sites: held }) => [fingerprint, held?.map(({ line }) => line)])).toEqual([
    ['f', [5, 2]],
    ['g', undefined],
  ]);
  expect(fresh(units, unitsOf([at('f', 9)]), []).map(({ fingerprint }) => fingerprint)).toEqual(['g']);
  expect(siteRows(fresh(units, [], [])).map(({ fingerprint, line }) => [fingerprint, line])).toEqual([
    ['f', 5],
    ['f', 2],
    ['g', 1],
  ]);
  expect(() => unitsOf([at('f', 1, 5), at('f', 2, 5)])).toThrow();
});

test('each site of a grouped unit keeps what its own violation says and how to fix it', () => {
  const said = (line: number, specifier: string) => ({
    ...at('f', line),
    specifier,
    message: `imports ${specifier}`,
    fix: `open ${specifier}`,
  });
  expect(siteRows(unitsOf([said(1, 'a'), said(2, 'b')])).map(({ line, message, fix }) => [line, message, fix])).toEqual([
    [1, 'imports a', 'open a'],
    [2, 'imports b', 'open b'],
  ]);
});

test('a key repeated with a value, in whatever mix, is a duplicated valued key', () => {
  expect(valuedDuplicate([at('f', 1, 5), at('f', 2)])).toBe('f');
  expect(valuedDuplicate([at('f', 1), at('f', 2, 5)])).toBe('f');
  expect(valuedDuplicate([at('f', 1, 5), at('g', 2, 5), at('h', 3), at('h', 4)])).toBeUndefined();
});
