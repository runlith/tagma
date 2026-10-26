import { describe, expect, test } from 'vitest';
import { formatBytes, formatCpu, UNMEASURED } from './figures.js';

describe('a missing measurement is the mark, never zero', () => {
  test('cpu and memory nobody sampled print the mark', () => {
    expect(formatCpu(null)).toBe(UNMEASURED);
    expect(formatBytes(null)).toBe(UNMEASURED);
  });
});

describe('bytes are binary units, and a small figure keeps its tenth', () => {
  test('each step of 1024 is the next unit, with one decimal under ten', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MiB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GiB');
  });
});
