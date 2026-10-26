import { describe, expect, test } from 'bun:test';
import { foldDiacritics, levenshtein, normalizeLoose } from './text.js';

describe('foldDiacritics', () => {
  test('folds Serbian diacritics and stroke letters to ASCII bases', () => {
    expect(foldDiacritics('čćšž')).toBe('ccsz');
    expect(foldDiacritics('Đak')).toBe('Dak');
    expect(foldDiacritics('résumé')).toBe('resume');
  });
});

describe('normalizeLoose', () => {
  test('lowercases, trims, collapses whitespace, strips diacritics', () => {
    expect(normalizeLoose('  Kuća  ')).toBe('kuca');
    expect(normalizeLoose('NEMA   problema')).toBe('nema problema');
    expect(normalizeLoose('Đak')).toBe('dak');
  });
});

describe('levenshtein', () => {
  test('counts single-character edits', () => {
    expect(levenshtein('kuca', 'kuca')).toBe(0);
    expect(levenshtein('kuca', 'kuka')).toBe(1);
    expect(levenshtein('kuca', 'kucaa')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
