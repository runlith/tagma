import { describe, expect, test } from 'bun:test';
import { RetainedCeiling, type RetainedVerdict } from './RetainedCeiling.js';

const GIB = 1024 ** 3;
const SAMPLE_MS = 5_000;
const bounds = { bytes: 16 * GIB, windowMs: 60_000, windows: 5 };

function sampled(retained: (at: number) => number, minutes: number): RetainedVerdict[] {
  const ceiling = new RetainedCeiling(bounds);
  const verdicts: RetainedVerdict[] = [];
  for (let at = 0; at <= minutes * 60_000; at += SAMPLE_MS) verdicts.push(ceiling.observe(at, retained(at)));
  return verdicts;
}

describe('RetainedCeiling', () => {
  test('bursts the collector reclaims between samples never reach the ceiling, however high they peak', () => {
    const verdicts = sampled((at) => ((at / SAMPLE_MS) % 4 === 3 ? 2 * GIB : 20 * GIB), 30);
    expect(verdicts.every((verdict) => verdict === 'hold')).toBe(true);
  });

  test('a floor past the ceiling is pressed after one window and sustained after the configured windows', () => {
    const verdicts = sampled(() => 17 * GIB, 6);
    expect(verdicts.indexOf('pressed')).toBe(12);
    expect(verdicts.indexOf('sustained')).toBe(60);
  });

  test('retained growth that crosses the ceiling is sustained only once its floor has stayed past it', () => {
    const growing = (at: number) => 10 * GIB + (at / 60_000) * GIB;
    const verdicts = sampled(growing, 20);
    const first = verdicts.indexOf('sustained');
    expect(first).toBeGreaterThan(0);
    expect(growing(first * SAMPLE_MS - 5 * 60_000)).toBeGreaterThan(bounds.bytes);
  });

  test('a cleared ceiling counts its windows again from none', () => {
    const ceiling = new RetainedCeiling(bounds);
    const verdicts: RetainedVerdict[] = [];
    for (let at = 0; at <= 5 * 60_000; at += SAMPLE_MS) verdicts.push(ceiling.observe(at, 17 * GIB));
    expect(verdicts.at(-1)).toBe('sustained');
    ceiling.cleared();
    expect(ceiling.observe(5 * 60_000 + SAMPLE_MS, 17 * GIB)).toBe('hold');
    expect(ceiling.observe(6 * 60_000, 17 * GIB)).toBe('pressed');
  });
});
