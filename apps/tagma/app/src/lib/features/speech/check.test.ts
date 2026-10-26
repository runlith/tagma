import type { Heard } from '@tagma/server/speech/contract/wire/listening';
import type { DevicesStatus } from '@tagma/server/speech/contract/wire/status';
import { expect, test } from 'vitest';
import { apply, emptyRun, fault, over, readiness, SILENCE_MS, type Run } from './check.js';

const level = (peak: number): Heard => ({ kind: 'level', track: 'mic', at: 0, rms: peak / 2, peak });
const phase = (
  value: 'connecting' | 'live' | 'waiting' | 'failed' | 'finished',
  fields: { queuedMs?: number; retryInMs?: number; reason?: string } = {},
): Heard => ({
  kind: 'track',
  track: 'mic',
  phase: value,
  queuedMs: fields.queuedMs ?? null,
  retryInMs: fields.retryInMs ?? null,
  reason: fields.reason ?? null,
});
const through = (events: readonly [number, Heard][]): Run => events.reduce((run, [at, heard]) => apply(run, heard, at), emptyRun);
const diagnose = (run: Run, now: number) => fault(run.tracks.mic, 0, now)?.kind ?? null;

test('each failure of a running track is told from the others', () => {
  expect(diagnose(through([[0, phase('live')]]), 3_500)).toBe('no-frames');
  expect(
    diagnose(
      through([
        [0, phase('live')],
        [100, level(0.2)],
      ]),
      3_000,
    ),
  ).toBeNull();
  expect(
    diagnose(
      through([
        [0, phase('live')],
        [100, level(0.2)],
      ]),
      3_600,
    ),
  ).toBe('no-frames');
  expect(
    diagnose(
      through([
        [0, phase('live')],
        [100, level(0)],
        [2_000, level(0.0004)],
        [100 + SILENCE_MS, level(0)],
      ]),
      200 + SILENCE_MS,
    ),
  ).toBe('silence');
  expect(
    diagnose(
      through([
        [0, phase('live')],
        [100, level(0)],
        [600, level(0.3)],
        [6_000, level(0)],
      ]),
      6_100,
    ),
  ).toBeNull();
  expect(diagnose(through([[0, phase('connecting')]]), 3_500)).toBe('recognizer-not-ready');
  expect(diagnose(through([[0, phase('waiting', { retryInMs: 800 })]]), 100)).toBe('recognizer-not-ready');
  expect(
    diagnose(
      through([
        [0, phase('live', { queuedMs: 4_200 })],
        [100, level(0.2)],
      ]),
      200,
    ),
  ).toBeNull();
  expect(
    diagnose(
      through([
        [0, phase('live', { queuedMs: 4_200 })],
        [50, phase('live', { queuedMs: 5_100 })],
        [100, level(0.2)],
      ]),
      200,
    ),
  ).toBe('queue-growing');
  expect(diagnose(through([[0, level(0.2)]]), 100)).toBeNull();
  expect(
    diagnose(
      through([
        [0, level(0.2)],
        [9_900, level(0.2)],
      ]),
      10_000,
    ),
  ).toBeNull();
  expect(diagnose(through([[0, level(0.2)]]), 3_500)).toBe('no-frames');
  expect(fault(through([[0, phase('failed', { reason: 'HTTP 401' })]]).tracks.mic, 0, 10)).toEqual({
    kind: 'provider-error',
    reason: 'HTTP 401',
  });
  expect(diagnose(through([[0, phase('finished')]]), 20_000)).toBeNull();
});

test('a corrected utterance replaces its line and an older revision does not', () => {
  const said = (revision: number, text: string): Heard => ({
    kind: 'utterance',
    track: 'mic',
    segment: 1,
    seq: 4,
    revision,
    closed: revision > 1,
    text,
    hypothesis: '',
    from: 0,
    to: 1,
    speaker: null,
  });
  const run = through([
    [0, said(2, 'hello world')],
    [1, said(1, 'hello')],
    [2, phase('finished')],
  ]);
  expect(run.said.map((one) => one.text)).toEqual(['hello world']);
  expect(over(run, 1)).toBe(true);
  expect(over(run, 2)).toBe(false);
});

test('the machine states are told apart before any capture starts', () => {
  const devices = (patch: Partial<DevicesStatus>): DevicesStatus => ({
    capabilities: { mic: true, system: false, excludeSelf: false, echoCancel: false, muteOutput: false, permissionPrompt: true },
    availability: { _tag: 'present' },
    inputs: [],
    permissions: { mic: 'not-asked', system: 'unknown' },
    refusal: null,
    said: null,
    ...patch,
  });
  expect(readiness('mic', devices({}))).toBeNull();
  expect(readiness('system', devices({}))?.kind).toBe('no-capability');
  expect(readiness('mic', devices({ permissions: { mic: 'denied', system: 'unknown' } }))).toEqual({ kind: 'permission', state: 'denied' });
  expect(
    readiness(
      'mic',
      devices({
        availability: { _tag: 'absent', reason: 'helper is not installed', unblock: ['install Tagma.app'] },
        said: 'Tagma cannot reach the sound of this Mac.',
      }),
    ),
  ).toEqual({
    kind: 'no-capability',
    said: 'Tagma cannot reach the sound of this Mac.',
    details: ['helper is not installed', 'install Tagma.app'],
  });
});
