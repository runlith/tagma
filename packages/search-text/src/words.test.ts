import { expect, test } from 'bun:test';
import { normalize, words } from './words.js';

test('normalization folds case, Latin diacritics and ё, and keeps marks that make another letter', () => {
  expect(normalize('Café Ёлка')).toBe('cafe елка');
  expect(normalize('Йод Über İstanbul')).toBe('йод uber istanbul');
});

test('a letter keeps its combining marks inside one word', () => {
  expect(words('भारत')).toEqual(['भारत']);
  expect(words('ภาษาไทย')).toEqual(['ภาษา', 'ไทย']);
});

test('unspaced scripts are cut into words', () => {
  expect(words('黑山旅游怎么样')).toEqual(['黑山', '旅游', '怎么', '样']);
  expect(words('東京に行きたい trip')).toEqual(['東京', 'に', '行き', 'たい', 'trip']);
});

test('identifiers and paths stay one word, and sentence punctuation leaves the word', () => {
  expect(words('See server/src/learning/journal.ts, ppocr-layout and #rule.')).toEqual([
    'see',
    'server/src/learning/journal.ts',
    'ppocr-layout',
    'and',
    '#rule',
  ]);
  expect(words('src/黑山/reader.ts 黑山2024')).toEqual(['src/黑山/reader.ts', '黑山2024']);
  expect(words('— … !!')).toEqual([]);
});
