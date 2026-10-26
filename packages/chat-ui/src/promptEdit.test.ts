import { expect, test } from 'vitest';
import { editOf } from './promptEdit';

test('an edit is read from the selection it replaced, even where the text repeats', () => {
  expect(editOf('say echo echo', 8, 8, 'say echo', 3)).toEqual({ from: 3, to: 8, text: '' });
  expect(editOf('say echo echo', 8, 8, 'say echo', 8)).toEqual({ from: 8, to: 13, text: '' });
  expect(editOf('abc', 1, 3, 'aXYZ', 4)).toEqual({ from: 1, to: 3, text: 'XYZ' });
  expect(editOf('abc', 1, 1, 'ac', 1)).toEqual({ from: 1, to: 2, text: '' });
});

test('an edit the selection cannot explain is unknown', () => {
  expect(editOf('abc', 0, 0, 'abd', 0)).toBeNull();
});
