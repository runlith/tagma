import { expect, test } from 'bun:test';
import { ProcessesUnreadable } from '../../ProcessReader';
import { bornBetween, compareBirth } from './birth';

test('native birth ordering retains microseconds across a seconds boundary', () => {
  expect(compareBirth('2:1', '1:999999')).toBe(1);
  expect(compareBirth('1:999999', '2:1')).toBe(-1);
  expect(compareBirth('2:1200', '2:1200')).toBe(0);
});

test('accounting brackets native birth without rounding it to milliseconds', () => {
  expect(bornBetween('2:1200', 2001.1, 2001.3)).toBe(true);
  expect(bornBetween('2:1201', 2001.2, 2001.2)).toBe(false);
  expect(bornBetween('2:1200', 2001.2, 2001.2)).toBe(true);
});

test('an unrecognized native birth refuses ordering and interval attribution', () => {
  for (const birth of ['1024', 'x:1', '1:', ':1', '1:0:0', '1:1000000', '1:0.5', '18446744073709551616:0']) {
    expect(compareBirth(birth, '1:0')).toBeInstanceOf(ProcessesUnreadable);
    expect(compareBirth('1:0', birth)).toBeInstanceOf(ProcessesUnreadable);
    expect(bornBetween(birth, 0, 2000)).toBeInstanceOf(ProcessesUnreadable);
  }
});

test('an unrepresentable accounting interval is unreadable', () => {
  expect(bornBetween('1:0', Number.NaN, 2000)).toBeInstanceOf(ProcessesUnreadable);
  expect(bornBetween('1:0', 0, Number.POSITIVE_INFINITY)).toBeInstanceOf(ProcessesUnreadable);
  expect(bornBetween('1:0', 2000, 1000)).toBeInstanceOf(ProcessesUnreadable);
});
