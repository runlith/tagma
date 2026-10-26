import { describe, expect, test } from 'bun:test';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, THREAD_RUN_RESUMING_STAGE } from './storage/runs';
import { STALL_FLOOR_MS } from '../agent/callProgress';
import { NATIVE_CAPABILITIES } from './record';
import { currentRunOf, runLife, runSignals, stalledBefore, type CurrentRunFacts, type RunMovement } from './state';

const RHYTHM = { heartbeatIntervalMs: 1_000, staleRunningAfterMs: 10_000, takeoverAfterMs: 3_000 };
const ENVELOPE_MS = 2 * STALL_FLOOR_MS;
const NOW = new Date('2026-10-08T12:00:00.000Z');

const thread = (updatedAt: Date, callEnvelopeMs: number | null = ENVELOPE_MS): RunMovement => ({
  updatedAt,
  capabilities: { ...NATIVE_CAPABILITIES, callEnvelopeMs },
});

const running = (over: Partial<CurrentRunFacts> = {}): CurrentRunFacts => ({
  id: 'run',
  status: 'running',
  progress: { stage: 'streaming' },
  startedAt: new Date(NOW.getTime() - 3_600_000),
  heartbeatAt: NOW,
  handedOverAt: null,
  ...over,
});

describe('the liveness of one run', () => {
  test('a parked run awaits however old, and a quiet one stalls only past its thread’s call envelope', () => {
    const old = new Date(NOW.getTime() - 3_600_000);
    expect(runLife({ stage: 'awaiting-question', thread: thread(old) }, NOW)).toBe('awaiting');
    expect(runLife({ stage: null, thread: thread(old) }, NOW)).toBe('stalled');
    expect(runLife({ stage: null, thread: thread(stalledBefore(NOW, ENVELOPE_MS)) }, NOW)).toBe('working');
    expect(runLife({ stage: null, thread: thread(new Date(NOW.getTime() - 30_000)) }, NOW)).toBe('working');
  });

  test('a short call envelope never stalls a run before twice the idle limit', () => {
    const short = (ageMs: number) => runLife({ stage: null, thread: thread(new Date(NOW.getTime() - ageMs), 60_000) }, NOW);
    expect(short(STALL_FLOOR_MS)).toBe('working');
    expect(short(STALL_FLOOR_MS + 1)).toBe('stalled');
  });

  test('a thread whose transport judges no envelope never stalls', () => {
    expect(runLife({ stage: null, thread: thread(new Date(0), null) }, NOW)).toBe('working');
  });
});

describe('run signals', () => {
  const rhythm = { heartbeatIntervalMs: 5, staleRunningAfterMs: 600, takeoverAfterMs: 15 };
  const base = { ...running(), startedAt: new Date(0), heartbeatAt: new Date(0) };
  const moved = thread(new Date(0), STALL_FLOOR_MS);

  test('progress stall, stale heartbeat evidence and recovery move apart', () => {
    expect(runSignals(base, moved, new Date(10), rhythm)).toEqual({
      life: 'working',
      stalledSince: null,
      ownership: 'held',
      changesAt: new Date(16),
    });
    expect(runSignals({ ...base, heartbeatAt: new Date(STALL_FLOOR_MS - 5) }, moved, new Date(STALL_FLOOR_MS + 1), rhythm)).toEqual({
      life: 'stalled',
      stalledSince: moved.updatedAt,
      ownership: 'held',
      changesAt: new Date(STALL_FLOOR_MS + 11),
    });
    expect(runSignals(base, moved, new Date(50), rhythm)).toEqual({
      life: 'working',
      stalledSince: null,
      ownership: 'stale-evidence',
      changesAt: new Date(STALL_FLOOR_MS + 1),
    });
    expect(runSignals({ ...base, handedOverAt: new Date(1) }, moved, new Date(50), rhythm)?.ownership).toBe('recovering');
    expect(runSignals({ ...base, progress: { stage: THREAD_RUN_RESUMING_STAGE } }, moved, new Date(50), rhythm)?.ownership).toBe(
      'recovering',
    );
  });

  test('a run parked on a question never stalls and reads held', () => {
    const parked: CurrentRunFacts = { ...base, progress: { stage: THREAD_RUN_AWAITING_QUESTION_STAGE } };
    expect(runSignals(parked, moved, new Date(10_000), rhythm)).toEqual({
      life: 'awaiting',
      stalledSince: null,
      ownership: 'held',
      changesAt: null,
    });
  });

  test('a settled run has no signals', () => {
    expect(runSignals({ ...base, status: 'completed' }, moved, new Date(10_000), rhythm)).toBeNull();
  });
});

describe('the current run of a thread', () => {
  test('it names the stall of a run that has not moved past the envelope, and a parked run awaits', () => {
    const quiet = thread(new Date(NOW.getTime() - 2 * ENVELOPE_MS), 60_000);
    expect(currentRunOf(running(), quiet, NOW, RHYTHM)).toMatchObject({ runId: 'run', life: 'working', stalledSince: quiet.updatedAt });
    expect(currentRunOf(running({ progress: { stage: THREAD_RUN_AWAITING_QUESTION_STAGE } }), quiet, NOW, RHYTHM)).toMatchObject({
      life: 'awaiting',
      stalledSince: null,
    });
    expect(currentRunOf(running({ status: 'completed' }), thread(NOW), NOW, RHYTHM)).toBeNull();
  });
});
