import { describe, expect, test } from 'vitest';
import { callDuration, elapsedDuration } from './chatTime';

describe('callDuration', () => {
  test('keeps sub-second calls apart, which is the whole reason the number is shown', () => {
    expect(callDuration(12)).toBe('12ms');
    expect(callDuration(200)).toBe('200ms');
    expect(callDuration(970)).toBe('970ms');
  });

  test('separates neighbouring seconds by their tenth', () => {
    expect(callDuration(1000)).toBe('1.0s');
    expect(callDuration(2400)).toBe('2.4s');
  });

  test('drops the tenth once a call runs into minutes', () => {
    expect(callDuration(61_000)).toBe('1m 1s');
  });
});

describe('elapsedDuration', () => {
  test('moves in whole seconds, so a live badge does not repaint digits nobody acts on', () => {
    expect(elapsedDuration(970)).toBe('0s');
    expect(elapsedDuration(8400)).toBe('8s');
  });

  test('pads the units after the leading one, so a ticking clock keeps its width', () => {
    expect(elapsedDuration(65_000)).toBe('1m 05s');
    expect(elapsedDuration(7_325_000)).toBe('2h 02m 05s');
  });
});
