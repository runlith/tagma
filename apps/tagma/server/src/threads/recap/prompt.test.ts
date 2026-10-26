import { expect, test } from 'bun:test';
import { readRecap } from './prompt.js';

const prose = (count: number): string => Array.from({ length: count }, () => 'слово').join(' ');
const ref = '[[c478e2d3|спека о связи агентов]]';

test('a block reference counts as one word and reaches the recap verbatim', () => {
  const summary = `${prose(100)} ${Array.from({ length: 10 }, () => ref).join(', ')}.`;
  const next = `Дождаться отчёта по ${ref}.`;

  expect(readRecap(`SUMMARY: ${summary}\nNEXT: ${next}`)).toEqual({ kind: 'recap', summary, next });
});

test('prose past the word limit is refused whatever references it carries', () => {
  expect(readRecap(`SUMMARY: ${prose(121)} ${ref}\nNEXT: none`)).toEqual({ kind: 'failed', reason: 'too-long' });
});
