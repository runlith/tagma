import { expect, test } from 'bun:test';
import { trigramForm } from './trigram.js';

test('unspaced characters double so a two-character word reaches a trigram', () => {
  expect(trigramForm('黑山')).toBe('黑黑山山');
  expect(trigramForm('東京に')).toBe('東東京京にに');
  expect(trigramForm('한국')).toBe('한한국국');
});

test('spaced and alphabetic scripts keep their form', () => {
  expect(['trip', 'черногор', 'भारत', 'ไทย', 'src/a.ts'].map(trigramForm)).toEqual(['trip', 'черногор', 'भारत', 'ไทย', 'src/a.ts']);
});
