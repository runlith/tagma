import { expect, test } from 'bun:test';
import type { Act } from '@runlith/speech/protocol/codec';
import type { SpeechEvent } from '@runlith/speech/wire/events';
import type { SpeechFailure } from '@runlith/speech/wire/failure';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Result } from 'effect';
import { recognitionModels } from './models.ts';
import { type Listening, recognition } from './recognition.ts';

const [live, gpt4o] = recognitionModels;
if (live === undefined || gpt4o === undefined) throw new Error('openai declares its recognition models');

const request = (turns: RecognitionRequest['turns']): RecognitionRequest => ({
  turns,
  rate: 24_000,
  languages: [],
  detect: false,
  speakers: false,
  terms: [],
  tuning: {},
});

const frame = (type: string, fields: Record<string, unknown> = {}) => JSON.stringify({ type, ...fields });
const delta = (item: string, text: string) => frame('conversation.item.input_audio_transcription.delta', { item_id: item, delta: text });
const completed = (item: string, transcript: string) =>
  frame('conversation.item.input_audio_transcription.completed', { item_id: item, transcript });
const failed = (item: string) =>
  frame('conversation.item.input_audio_transcription.failed', { item_id: item, error: { message: 'unreadable' } });
const committed = (item: string) => frame('input_audio_buffer.committed', { item_id: item });

type Step = string | ((state: Listening) => Act<Listening>);

const session = (model: typeof live, turns: RecognitionRequest['turns'], steps: ReadonlyArray<Step>) => {
  const protocol = recognition(model, request(turns), { apiKey: 'k' });
  let state: Listening = protocol.initial;
  const events: Array<SpeechEvent> = [];
  const failures: Array<SpeechFailure> = [];
  const sent: Array<unknown> = [];
  for (const next of steps) {
    if (typeof next !== 'string') {
      const act = next(state);
      state = act.state;
      events.push(...act.events);
      sent.push(...act.send);
      continue;
    }
    const decoded = protocol.decode(next);
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
  return { protocol, events, failures, sent, state };
};

const commit =
  (turns: RecognitionRequest['turns'], number: number): Step =>
  (state) =>
    recognition(live, request(turns), { apiKey: 'k' }).commit?.(state, number) ?? { state, send: [], events: [] };

const finish =
  (turns: RecognitionRequest['turns'], sent = 0): Step =>
  (state) =>
    recognition(live, request(turns), { apiKey: 'k' }).finish(state, sent);

test('completions of different items arrive out of order and each keeps its own item and text', () => {
  const { events } = session(live, 'client', [
    frame('session.updated'),
    commit('client', 1),
    commit('client', 2),
    committed('item_a'),
    committed('item_b'),
    delta('item_a', 'Good'),
    delta('item_a', ' morning'),
    delta('item_b', 'Yes'),
    completed('item_b', 'Yes.'),
    completed('item_a', 'Good morning.'),
  ]);
  expect(events.map((event) => [event._tag, 'turn' in event ? event.turn : '', 'commit' in event ? event.commit : ''])).toEqual([
    ['Committed', 'item_a', 1],
    ['Committed', 'item_b', 2],
    ['Partial', 'item_a', ''],
    ['Partial', 'item_a', ''],
    ['Partial', 'item_b', ''],
    ['Final', 'item_b', ''],
    ['TurnEnd', 'item_b', ''],
    ['Final', 'item_a', ''],
    ['TurnEnd', 'item_a', ''],
  ]);
  const second = events[3];
  expect(second?._tag === 'Partial' && second.text).toBe('Good morning');
});

test('Finished comes only when every confirmed commit has completed or failed', () => {
  const { events } = session(live, 'client', [
    frame('session.updated'),
    commit('client', 1),
    commit('client', 2),
    finish('client'),
    committed('item_a'),
    completed('item_a', 'One.'),
    committed('item_b'),
    failed('item_b'),
  ]);
  expect(events.map((event) => event._tag)).toEqual(['Committed', 'Final', 'TurnEnd', 'Committed', 'TurnFailed', 'Finished']);
  const failure = events[4];
  expect(failure?._tag === 'TurnFailed' && failure.message).toBe('unreadable');
});

test('finishing with nothing outstanding finishes at once', () => {
  const { events } = session(live, 'client', [frame('session.updated'), finish('client')]);
  expect(events.map((event) => event._tag)).toEqual(['Finished']);
});

test('server speech boundaries become SpeechStart and SpeechEnd at the session sample rate', () => {
  const { events } = session(gpt4o, 'provider', [
    frame('session.updated'),
    frame('input_audio_buffer.speech_started', { item_id: 'item_a', audio_start_ms: 1_000 }),
    frame('input_audio_buffer.speech_stopped', { item_id: 'item_a', audio_end_ms: 2_500 }),
    committed('item_a'),
    delta('item_a', 'Hi'),
    completed('item_a', 'Hi there.'),
  ]);
  expect(events.map((event) => [event._tag, 'at' in event ? event.at : ''])).toEqual([
    ['SpeechStart', 24_000],
    ['SpeechEnd', 60_000],
    ['Partial', ''],
    ['Final', ''],
    ['TurnEnd', ''],
  ]);
});

test('finishing commits the tail even before any server speech event and waits for its item', () => {
  const waiting = session(gpt4o, 'provider', [frame('session.updated'), finish('provider', 48_000)]);
  expect(waiting.sent).toEqual([frame('input_audio_buffer.commit')]);
  expect(waiting.events).toEqual([]);
  const settled = session(gpt4o, 'provider', [
    frame('session.updated'),
    finish('provider', 48_000),
    committed('item_a'),
    completed('item_a', 'Tail.'),
  ]);
  expect(settled.events.map((event) => event._tag)).toEqual(['Final', 'TurnEnd', 'Finished']);
});

test('an empty buffer at finish after a completed turn is acknowledged and finishes without losing the earlier item', () => {
  const { events } = session(gpt4o, 'provider', [
    frame('session.updated'),
    frame('input_audio_buffer.speech_started', { item_id: 'item_a', audio_start_ms: 0 }),
    frame('input_audio_buffer.speech_stopped', { item_id: 'item_a', audio_end_ms: 1_000 }),
    committed('item_a'),
    completed('item_a', 'Done.'),
    finish('provider', 48_000),
    frame('error', { error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty', message: 'empty' } }),
  ]);
  expect(events.map((event) => event._tag)).toEqual(['SpeechStart', 'SpeechEnd', 'Final', 'TurnEnd', 'Finished']);
});

test('the finish tail committed over active speech keeps the speech start and ends at the sent endpoint', () => {
  const { events } = session(gpt4o, 'provider', [
    frame('session.updated'),
    frame('input_audio_buffer.speech_started', { item_id: 'item_a', audio_start_ms: 1_000 }),
    finish('provider', 96_000),
    committed('item_b'),
    completed('item_b', 'Tail.'),
  ]);
  expect(events.map((event) => [event._tag, 'turn' in event ? event.turn : '', 'at' in event ? event.at : ''])).toEqual([
    ['SpeechStart', 'item_a', 24_000],
    ['TurnEnd', 'item_a', ''],
    ['SpeechStart', 'item_b', 24_000],
    ['SpeechEnd', 'item_b', 96_000],
    ['Final', 'item_b', ''],
    ['TurnEnd', 'item_b', ''],
    ['Finished', '', ''],
  ]);
});

test('a completion without its transcript is a provider failure, not a promoted hypothesis', () => {
  const { failures, events } = session(live, 'client', [
    frame('session.updated'),
    commit('client', 1),
    committed('item_a'),
    delta('item_a', 'Maybe'),
    frame('conversation.item.input_audio_transcription.completed', { item_id: 'item_a' }),
  ]);
  expect(failures.map((failure) => failure.reason)).toEqual(['provider']);
  expect(events.map((event) => event._tag)).toEqual(['Committed', 'Partial']);
});

test('a vendor error is a typed failure and an empty commit is not a failure', () => {
  const { failures, events } = session(live, 'client', [
    frame('session.updated'),
    frame('error', { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'bad key' } }),
    frame('error', { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'slow down' } }),
    frame('error', { error: { type: 'invalid_request_error', code: 'unknown_parameter', message: 'no such field' } }),
    commit('client', 1),
    frame('error', { error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty', message: 'empty' } }),
    finish('client'),
  ]);
  expect(failures.map((failure) => [failure.reason, failure.retryable])).toEqual([
    ['auth', false],
    ['rate', true],
    ['invalid-request', false],
  ]);
  expect(events.map((event) => event._tag)).toEqual(['Finished']);
});
