import { expect, test } from 'vitest';
import { colorsOf, isColor, swatchOf, withColor } from './colors.js';

test('a slot writes into the record and leaves the others where they were', () => {
  const record = { foreground: '#ffffff', red: '#cc6666' };

  expect(withColor(record, 'background', '#101010')).toEqual({
    foreground: '#ffffff',
    red: '#cc6666',
    background: '#101010',
  });
  expect(withColor(record, 'red', '#ff0000')).toEqual({ foreground: '#ffffff', red: '#ff0000' });

  expect(record).toEqual({ foreground: '#ffffff', red: '#cc6666' });
});

test('a blank clears the slot rather than storing an empty colour', () => {
  expect(withColor({ foreground: '#ffffff', red: '#cc6666' }, 'foreground', '')).toEqual({ red: '#cc6666' });
  expect(withColor({ foreground: '#ffffff' }, 'foreground', '   ')).toEqual({});
  expect(withColor({ red: '#cc6666' }, 'blue', '')).toEqual({ red: '#cc6666' });
});

test('a value that is not a record of colours holds no slots, so nothing is written back from one', () => {
  expect(colorsOf({ foreground: '#fff', red: 7, blue: '' })).toEqual({ foreground: '#fff' });
  expect(colorsOf('#ffffff')).toEqual({});
  expect(colorsOf(['#ffffff'])).toEqual({});
  expect(colorsOf(null)).toEqual({});
});

test('a hex is three or six digits behind a hash, and the swatch falls back when it is neither', () => {
  expect(isColor('#fff')).toBe(true);
  expect(isColor('#AABBCC')).toBe(true);
  expect(isColor('#ff00')).toBe(false);
  expect(isColor('red')).toBe(false);

  expect(swatchOf('#123456')).toBe('#123456');
  expect(swatchOf(undefined)).toBe('');
});
