import { expect, test } from 'bun:test';
import { typedBack, typedShape } from './input.js';

test('a composer is Tagma’s own only when it shows words Tagma typed in that turn, verbatim or as the CLI’s collapsed paste of as many lines', () => {
  const typed = [typedShape('<input envelope="a" length="3" digest="d">\nWrite a poem\n</input>')];
  const wrapped = '<input envelope="a" length="3"\ndigest="d">\nWrite a poem\n</input>';
  expect(typedBack(wrapped, typed, 'breaks')).toBe(true);
  expect(typedBack('[Pasted text #4 +2 lines]', typed, 'breaks')).toBe(true);
  expect(typedBack('[Pasted text #4 +3 lines]', typed, 'lines')).toBe(true);
  expect(typedBack('[Pasted text #4 +3 lines]', typed, 'breaks')).toBe(false);
  expect(typedBack(`${wrapped} and my own words`, typed, 'breaks')).toBe(false);
  expect(typedBack('operator draft', typed, 'breaks')).toBe(false);
});
