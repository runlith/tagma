import { expect, test } from 'bun:test';
import { stem } from './stem.js';
import { words } from './words.js';

test('every Russian form of a word collapses onto one stem', () => {
  expect(sharedStem('обучение обучения обучению обучением')).toBe('обучен');
  expect(sharedStem('карта карты карте картой карт')).toBe('карт');
  expect(sharedStem('блок блока блоку блоком блоки')).toBe('блок');
  expect(sharedStem('страница страницы страниц')).toBe('страниц');
  expect(sharedStem('язык языка языки языков')).toBe('язык');
  expect(sharedStem('ёлка елки Ёлкой')).toBe('елк');
  expect(sharedStem('Черногория Черногорию Черногории')).toBe('черногор');
});

test('every English form of a word collapses onto one stem', () => {
  expect(sharedStem('trip trips')).toBe('trip');
  expect(sharedStem('study studies studied')).toBe('studi');
  expect(sharedStem('connect connected connecting connection connections')).toBe('connect');
  expect(sharedStem('run running')).toBe('run');
});

test('different words keep different stems', () => {
  expect(stem('карта')).not.toBe(stem('картина'));
  expect(stem('блок')).not.toBe(stem('блокировка'));
  expect(stem('язык')).not.toBe(stem('языковой'));
  expect(stem('generic')).not.toBe(stem('general'));
});

test('identifiers, mixed scripts and other scripts reach the index whole', () => {
  expect(words('ppocr-layout sha256 src/reader.ts тестJS भारत 黑山').map(stem)).toEqual([
    'ppocr-layout',
    'sha256',
    'src/reader.ts',
    'тестjs',
    'भारत',
    '黑山',
  ]);
});

test('short input survives', () => {
  expect(['я', 'и', 'к', 'a', 'is'].map(stem)).toEqual(['я', 'и', 'к', 'a', 'is']);
});

function sharedStem(text: string): string {
  const distinct = [...new Set(words(text).map(stem))];
  expect(distinct).toHaveLength(1);
  return distinct[0]!;
}
