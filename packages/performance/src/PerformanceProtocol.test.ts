import { expect, test } from 'bun:test';
import { stallCause, type StallPayload } from './protocol/records.js';

const memory = {
  rssBytes: 1_213_923_328,
  heapTotalBytes: 410_027_008,
  heapUsedBytes: 436_123_099,
  externalBytes: 103_728_818,
  arrayBufferBytes: 2_838_802,
};

const payload = (fields: {
  readonly delayMs: number;
  readonly userMicros: number;
  readonly systemMicros: number;
  readonly loopUserMicros?: number;
  readonly loopSystemMicros?: number;
  readonly cpuWindowMs?: number;
}): StallPayload => ({
  delayMs: fields.delayMs,
  cpu: { userMicros: fields.userMicros, systemMicros: fields.systemMicros },
  loopCpu:
    fields.loopUserMicros === undefined || fields.loopSystemMicros === undefined
      ? undefined
      : { userMicros: fields.loopUserMicros, systemMicros: fields.loopSystemMicros },
  cpuWindowMs: fields.cpuWindowMs,
  memory,
});

test('a freeze the process spent no CPU on is blocked', () => {
  expect(stallCause(payload({ delayMs: 4801.849167, userMicros: 14_855, systemMicros: 14_715, cpuWindowMs: 4826.8 }))).toBe('blocked');
});

test('a freeze whose loop thread spent most of its measured window on CPU is cpu', () => {
  expect(
    stallCause(
      payload({
        delayMs: 103.808667,
        userMicros: 240_825,
        systemMicros: 11_389,
        loopUserMicros: 110_000,
        loopSystemMicros: 2_000,
        cpuWindowMs: 128.8,
      }),
    ),
  ).toBe('cpu');
});

test('a legacy stall uses its delay as the window and keeps process CPU ambiguous', () => {
  expect(stallCause(payload({ delayMs: 4801.849167, userMicros: 14_855, systemMicros: 14_715 }))).toBe('blocked');
  expect(stallCause(payload({ delayMs: 103.808667, userMicros: 240_825, systemMicros: 11_389 }))).toBe('cpu-or-gc');
});

test('the cut is half the measured CPU window', () => {
  expect(
    stallCause(
      payload({
        delayMs: 100,
        userMicros: 100_000,
        systemMicros: 0,
        loopUserMicros: 100_000,
        loopSystemMicros: 0,
        cpuWindowMs: 200,
      }),
    ),
  ).toBe('cpu');
  expect(
    stallCause(
      payload({
        delayMs: 100,
        userMicros: 99_000,
        systemMicros: 0,
        loopUserMicros: 99_000,
        loopSystemMicros: 0,
        cpuWindowMs: 200,
      }),
    ),
  ).toBe('blocked');
});

test('worker CPU cannot turn a blocked loop into CPU work', () => {
  expect(
    stallCause(
      payload({
        delayMs: 100,
        userMicros: 300_000,
        systemMicros: 0,
        loopUserMicros: 1_000,
        loopSystemMicros: 0,
        cpuWindowMs: 125,
      }),
    ),
  ).toBe('blocked');
  expect(stallCause(payload({ delayMs: 100, userMicros: 300_000, systemMicros: 0, cpuWindowMs: 125 }))).toBe('cpu-or-gc');
});
