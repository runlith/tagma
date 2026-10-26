import { expect, test } from 'bun:test';
import type { SpeechEvent } from '@runlith/speech/wire/events';
import type { SpeechFailure } from '@runlith/speech/wire/failure';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Result } from 'effect';
import { recognitionModels } from './models.ts';
import { type Listening, recognition } from './recognition.ts';

const model = recognitionModels[0];
if (model === undefined) throw new Error('soniox declares a recognition model');

const request: RecognitionRequest = {
  turns: 'provider',
  rate: 16_000,
  languages: [],
  detect: false,
  speakers: true,
  terms: [],
  tuning: {},
};

const reply = (tokens: ReadonlyArray<Record<string, unknown>>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ tokens, final_audio_proc_ms: 0, total_audio_proc_ms: 0, ...extra });

const token = (text: string, from: number, to: number, isFinal: boolean, extra: Record<string, unknown> = {}) => ({
  text,
  start_ms: from,
  end_ms: to,
  confidence: 0.9,
  is_final: isFinal,
  ...extra,
});

const heard = (frames: ReadonlyArray<string>, over: RecognitionRequest = request) => {
  const protocol = recognition(model, over, { apiKey: 'k' });
  let state: Listening = protocol.initial;
  const events: Array<SpeechEvent> = [];
  const failures: Array<SpeechFailure> = [];
  for (const frame of frames) {
    const decoded = protocol.decode(frame);
    if (Result.isFailure(decoded)) {
      failures.push(decoded.failure);
      continue;
    }
    const acted = protocol.step(state, decoded.success);
    if (Result.isFailure(acted)) {
      failures.push(acted.failure);
      continue;
    }
    state = acted.success.state;
    events.push(...acted.success.events);
  }
  return { events, failures };
};

test('final and partial tokens of one turn arrive in order, then <end> closes the turn and the next turn gets a new key', () => {
  const { events } = heard([
    reply([token('Hel', 600, 700, true, { speaker: '1' }), token('lo', 700, 760, true, { speaker: '1' })]),
    reply([token(' wor', 800, 900, false)]),
    reply([token(' world', 800, 1000, true), token('<end>', 1000, 1000, true), token(' next', 1100, 1200, false)]),
    reply([token(' next', 1100, 1200, true), token('<end>', 1200, 1200, true)]),
  ]);
  expect(events.map((event) => [event._tag, 'turn' in event ? event.turn : undefined])).toEqual([
    ['Final', '0'],
    ['Partial', '0'],
    ['Final', '0'],
    ['TurnEnd', '0'],
    ['Partial', '1'],
    ['Final', '1'],
    ['TurnEnd', '1'],
  ]);
  const first = events[0];
  expect(first?._tag === 'Final' && first.units).toEqual([
    {
      lane: 'source',
      text: 'Hel',
      granularity: 'token',
      time: { from: 9_600, to: 11_200 },
      speaker: '1',
      language: undefined,
      confidence: 0.9,
    },
    {
      lane: 'source',
      text: 'lo',
      granularity: 'token',
      time: { from: 11_200, to: 12_160 },
      speaker: '1',
      language: undefined,
      confidence: 0.9,
    },
  ]);
  const partial = events[1];
  expect(partial?._tag === 'Partial' && partial.text).toBe(' wor');
});

test('translation tokens ride their own lane without time and name the source language', () => {
  const { events } = heard([
    reply([
      token('Hola', 100, 400, true, { translation_status: 'original', language: 'es' }),
      { text: 'Hello', is_final: true, translation_status: 'translation', language: 'en', source_language: 'es' },
      { text: ' wor', is_final: false, translation_status: 'translation', language: 'en', source_language: 'es' },
      token(' mun', 400, 500, false, { translation_status: 'original', language: 'es' }),
    ]),
  ]);
  const final = events[0];
  expect(final?._tag === 'Final' && final.units.map((unit) => [unit.lane, unit.text, 'time' in unit && unit.time !== undefined])).toEqual([
    ['source', 'Hola', true],
    ['translation', 'Hello', false],
  ]);
  const translation = final?._tag === 'Final' ? final.units[1] : undefined;
  expect(translation).toMatchObject({ lane: 'translation', language: 'en', origin: 'es' });
  const partial = events[1];
  expect(partial?._tag === 'Partial' && partial.text).toBe(' mun');
});

test('<fin> is a Finalized and finished closes an open turn before Finished', () => {
  const { events } = heard([
    reply([token('Hi', 0, 100, true), token('<fin>', 100, 100, true)]),
    reply([token(' there', 100, 300, true)]),
    reply([], { finished: true }),
  ]);
  expect(events.map((event) => event._tag)).toEqual(['Final', 'Finalized', 'Final', 'TurnEnd', 'Finished']);
});

test('without speech the stream still finishes normally', () => {
  const { events } = heard([reply([], { finished: true })]);
  expect(events.map((event) => event._tag)).toEqual(['Finished']);
});

test('a vendor error frame is a typed failure whose reason follows the status', () => {
  const error = (code: number) => JSON.stringify({ tokens: [], error_code: code, error_message: `status ${code}` });
  const { failures } = heard([error(401), error(402), error(429), error(400), error(503)]);
  expect(failures.map((failure) => [failure.reason, failure.retryable])).toEqual([
    ['auth', false],
    ['rate', false],
    ['rate', true],
    ['invalid-request', false],
    ['transport', true],
  ]);
});

test('the vendor error type decides the failure over the status code', () => {
  const error = (code: number, type: string) =>
    JSON.stringify({ tokens: [], error_code: code, error_type: type, error_message: type, request_id: 'r-1' });
  const { failures } = heard([
    error(402, 'organization_monthly_budget_exhausted'),
    error(403, 'temp_api_key_session_expired'),
    error(413, 'max_duration_reached'),
    error(429, 'limit_exceeded'),
  ]);
  expect(failures.map((failure) => [failure.reason, failure.retryable])).toEqual([
    ['rate', false],
    ['auth', false],
    ['transport', true],
    ['rate', true],
  ]);
  expect(failures[0]?.message).toContain('r-1');
});

test('a provisional suffix that disappears is retracted by an empty replacement, once', () => {
  const { events } = heard([
    reply([token('Hel', 0, 100, true), token(' guess', 100, 200, false)]),
    reply([token(' ', 100, 200, false)]),
    reply([]),
    reply([]),
    reply([token(' again', 200, 300, false)]),
    reply([token(' again', 200, 300, true), token('<end>', 300, 300, true)]),
    reply([]),
  ]);
  expect(events.map((event) => [event._tag, event._tag === 'Partial' ? event.text : ''])).toEqual([
    ['Final', ''],
    ['Partial', ' guess'],
    ['Partial', ' '],
    ['Partial', ''],
    ['Partial', ' again'],
    ['Final', ''],
    ['TurnEnd', ''],
  ]);
});

test('a frame of an unknown shape is a provider failure, not a silent drop', () => {
  const { failures } = heard(['not json', JSON.stringify({ tokens: 'oops' })]);
  expect(failures.map((failure) => failure.reason)).toEqual(['provider', 'provider']);
});
