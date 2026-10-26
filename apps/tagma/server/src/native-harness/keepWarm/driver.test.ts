import { describe, expect, test } from 'bun:test';
import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { type KeepWarmSubject, keepWarmPlan } from './driver.js';

const MEASURED = Date.parse('2026-09-25T10:00:00Z');
const TTL = 3_600_000;
const MARGIN = 60_000;
const DUE = MEASURED + TTL - MARGIN + 1;

const warm: ThreadCacheWarmth = {
  state: 'warm',
  heldTokens: 700_000,
  basis: 'promise',
  expiresAt: new Date(MEASURED + TTL).toISOString(),
  gap: null,
  warmShare: null,
  sample: null,
  oldestAt: null,
  invalidatedBy: null,
};

const waiting: KeepWarmSubject = {
  on: true,
  pings: 3,
  archived: false,
  running: false,
  waits: true,
  warmth: warm,
  measuredAt: MEASURED,
  latest: { runId: 'run-lead', status: 'completed', ping: null },
  spendableFrom: MEASURED,
};

const afterPing = (ping: number): KeepWarmSubject => ({
  ...waiting,
  latest: { runId: `run-ping-${ping}`, status: 'completed', ping: { anchor: 'run-lead', ping, sentAt: MEASURED - 5_000 } },
});

describe('keepWarmPlan', () => {
  test('a waiting warm thread is pinged a margin before its cache expires, and not earlier', () => {
    expect(keepWarmPlan(waiting, MEASURED + 1_000, MARGIN)).toEqual({ kind: 'at', at: MEASURED + TTL - MARGIN });
    expect(keepWarmPlan(waiting, DUE, MARGIN)).toEqual({ kind: 'ping', ping: { anchor: 'run-lead', ping: 1 } });
  });

  test('the pings of one wait are numbered from the run the wait began after, up to the count', () => {
    expect(keepWarmPlan(afterPing(1), DUE, MARGIN)).toEqual({ kind: 'ping', ping: { anchor: 'run-lead', ping: 2 } });
    expect(keepWarmPlan(afterPing(3), DUE, MARGIN)).toEqual({ kind: 'rest', reason: 'count' });
    expect(keepWarmPlan({ ...afterPing(3), pings: 4 }, DUE, MARGIN)).toEqual({
      kind: 'ping',
      ping: { anchor: 'run-lead', ping: 4 },
    });
  });

  test.each([
    ['off', { on: false }],
    ['archived', { archived: true }],
    ['running', { running: true }],
    ['not-waiting', { waits: false }],
    ['no-promise', { warmth: null }],
    ['no-promise', { warmth: { ...warm, basis: 'prior' as const, expiresAt: null } }],
    ['cold', { warmth: { ...warm, state: 'cold' as const, invalidatedBy: 'account' as const } }],
    ['unspendable', { spendableFrom: null }],
    ['interrupted', { latest: { runId: 'run-lead', status: 'cut' as const, ping: null } }],
  ] as const)('no ping when it would be %s', (reason, change) => {
    expect(keepWarmPlan({ ...waiting, ...change }, DUE, MARGIN)).toEqual({ kind: 'rest', reason });
  });

  test('an account held until a reset inside the window is pinged at the reset; one held past the expiry is left', () => {
    const reset = DUE + 20_000;
    expect(keepWarmPlan({ ...waiting, spendableFrom: reset }, DUE, MARGIN)).toEqual({ kind: 'at', at: reset });
    expect(keepWarmPlan({ ...waiting, spendableFrom: reset }, reset, MARGIN)).toMatchObject({ kind: 'ping' });
    expect(keepWarmPlan({ ...waiting, spendableFrom: MEASURED + TTL }, DUE, MARGIN)).toEqual({
      kind: 'rest',
      reason: 'unspendable',
    });
  });

  test('a ping whose request never measured is not sent again in the same window', () => {
    const unmeasured: KeepWarmSubject = {
      ...waiting,
      latest: { runId: 'run-ping-1', status: 'completed', ping: { anchor: 'run-lead', ping: 1, sentAt: MEASURED + 10_000 } },
    };
    expect(keepWarmPlan(unmeasured, DUE, MARGIN)).toEqual({ kind: 'rest', reason: 'tried' });
  });

  test('a cache already past its expiry is left cold', () => {
    expect(keepWarmPlan(waiting, MEASURED + TTL, MARGIN)).toEqual({ kind: 'rest', reason: 'cold' });
  });
});
