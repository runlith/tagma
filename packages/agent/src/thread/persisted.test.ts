import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { serializedThreadRunSchema } from '../protocol/http';
import {
  parseThreadHistory,
  parseThreadContextReading,
  parseThreadPendingInteraction,
  parseThreadRunFailure,
  parseThreadRunUsage,
  parseThreadRunProgress,
  runFacts,
  decodeThreadEventPayloadResult,
  threadEventPayloadSchema,
} from './persisted';
import { makeThreadEntryReader } from '../transcript/kinds';
import type { ThreadQuestionEntry } from '../transcript/entries';

const kinds = makeThreadEntryReader({ products: [] });

describe('persisted thread contract', () => {
  test('a stored stage outside the closed set is refused, not carried', () => {
    expect(() => parseThreadRunProgress({ stage: 'invented', message: null })).toThrow();
  });

  test('progress preserves phase across JSON and still admits a row with no phase', () => {
    const base = { stage: 'streaming' as const, message: null };
    const current = { ...base, phase: { phase: 'compacting' as const, since: 1700000000000 } };
    expect(parseThreadRunProgress(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(parseThreadRunProgress(base)).toEqual(base);
    expect(() => parseThreadRunProgress({ ...base, phase: { phase: 'invented', since: 1 } })).toThrow();
  });

  test('parses the full message vocabulary byte-honestly, provider extras included', () => {
    const history = [
      { role: 'system', content: [{ type: 'text', text: 'You are the assistant.' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this.' },
          { type: 'media', mediaType: 'image/png', data: '/api/thread-attachments/image-1' },
          { type: 'text', text: 'And this.', providerMetadata: { anthropic: { cacheControl: 'ephemeral' } } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Thinking.' },
          { type: 'tool-call', id: 'call-1', name: 'inspect', input: { query: 'q' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', id: 'call-1', name: 'inspect', result: { type: 'text', value: 'ok' } }],
      },
    ];

    expect(parseThreadHistory(history)).toEqual(history as never);
  });

  test('refuses a message an unknown writer left behind instead of narrowing it silently', () => {
    expect(() => parseThreadHistory([{ role: 'oracle', content: [] }])).toThrow('history cannot be read');
    expect(() => parseThreadHistory([{ role: 'assistant', content: [{ type: 'video', src: 'x' }] }])).toThrow('history cannot be read');
    expect(() => parseThreadHistory([{ role: 'tool', content: [{ type: 'tool-result', id: 'c', name: 'n' }] }])).toThrow(
      'history cannot be read',
    );
  });

  test('the folded-body mark survives the event payload persistence door', () => {
    const payload = {
      bodyInFold: true,
      entry: { type: 'tool', id: 'tool:c1', runId: 'run-1', toolName: 'read', toolCallId: 'c1', toolState: 'output-available' },
    };
    expect(Schema.decodeUnknownSync(threadEventPayloadSchema)(payload)).toEqual(payload);
  });

  test('an event facet this build does not know refuses the payload, while a known facet keeps reading extras', () => {
    const decode = (value: unknown) => decodeThreadEventPayloadResult(kinds, 'thread-1', value);
    expect(decode({ entry: { type: 'message', id: 'm-1', role: 'user' }, spliced: { from: 0, to: 1 } })._tag).toBe('Failure');
    expect(decode({ withdrawn: { runId: 'run-1', keepMessages: 1, since: 'later' } })._tag).toBe('Success');
    expect(decode({ compacted: { keepFrom: -1, messages: [] } })._tag).toBe('Failure');
  });

  test('a stored stream tail keeps an entry no kind reads as a line beside its neighbours, and stands as none for a value with no identity', () => {
    const said = { type: 'message', id: 'message-1', role: 'user', text: 'hi' };
    const tail = runFacts(kinds, { id: 'run-1', threadId: 'thread-1' }).streamTail;
    const [read, neighbour] = tail([{ type: 'language-task', id: 'task-1' }, said]) ?? [];
    expect(read).toMatchObject({ type: 'entry-unreadable', id: 'task-1' });
    expect(neighbour).toEqual(said);
    expect(tail([{ type: 'message' }])).toBeNull();
  });

  test('nullable slots answer null and refuse malformed bytes', () => {
    expect(parseThreadPendingInteraction(kinds, null)).toBeNull();
    expect(runFacts(kinds, { id: 'run-1', threadId: 'thread-1' }).streamTail(null)).toBeNull();
    expect(parseThreadRunUsage(null)).toBeNull();
    const question: ThreadQuestionEntry = {
      type: 'question',
      id: 'q-1',
      runId: 'run-1',
      questionId: 'q',
      questions: [],
      toolCalls: [],
      status: 'open',
    };
    expect(parseThreadPendingInteraction(kinds, question)).toEqual(question);
    expect(() => parseThreadPendingInteraction(kinds, { status: 'open' })).toThrow('pending interaction cannot be read');
    expect(() => parseThreadRunUsage({ inputTokens: 'many' })).toThrow('run usage cannot be read');
  });

  test('context readings round-trip exact coverage and refuse fabricated prefix counts', () => {
    const base = {
      usage: { inputTokens: 1_024 },
      contextWindow: 200_000,
      inputLimit: null,
      runId: 'run-1',
      stepNumber: 0,
      provider: 'anthropic',
      model: 'claude-opus-5',
      measuredAt: '2026-09-05T00:00:00.000Z',
      stale: false,
    };
    expect(parseThreadContextReading(kinds, base)).toMatchObject(base);
    const footprint = { messages: 2, messageDigest: 'message', promptDigest: 'prompt', toolDigests: ['search', 'read'] };
    const current = { ...base, attempt: 1, footprint };
    expect(parseThreadContextReading(kinds, JSON.parse(JSON.stringify(current)))).toMatchObject(current);
    for (const messages of [-1, 0.5]) {
      expect(() => parseThreadContextReading(kinds, { ...current, footprint: { ...footprint, messages } })).toThrow(
        'context reading cannot be read',
      );
    }
    expect(() => parseThreadContextReading(kinds, { ...current, footprint: { ...footprint, messageDigest: '' } })).toThrow(
      'context reading cannot be read',
    );
  });

  test('a stored run failure carrying a rate-limit window reads back and encodes on the wire', () => {
    const stored = JSON.parse(
      JSON.stringify({
        provider: 'subscription',
        account: 'account-1',
        stage: 'RequestExecutor.execute',
        type: 'RateLimit',
        httpStatus: 429,
        retryable: true,
        modelStarted: false,
        rateLimit: { retryAfterMs: 2_608_000, reset: { 'unified-5h': '1788414600' } },
        record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
      }),
    );
    const failure = parseThreadRunFailure(stored);
    expect(failure).toEqual(stored);
    expect(Schema.encodeSync(serializedThreadRunSchema.fields.failure)(failure)).toEqual(stored);
    expect(parseThreadRunFailure(null)).toBeNull();
    expect(() => parseThreadRunFailure({ stage: 'thread' })).toThrow('run failure cannot be read');
  });
});
