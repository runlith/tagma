import { describe, expect, test } from 'bun:test';
import {
  HttpRateLimitDetails,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
  StreamStalledReason,
  type WireFailureRecord,
} from '@runlith/llm/schema/errors';
import { AgentRetryFailed } from '../agent/AgentFailure';
import type { ThreadRunRow } from './rows';
import { threadFailureEntry } from './ThreadFailure';
import { parseThreadRunFailure } from './persisted';

describe('ThreadFailure', () => {
  test('projects a provider refusal into the durable public diagnostic contract', () => {
    const failure = new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: new InvalidRequestReason({
        message: 'Anthropic HTTP 400: input_schema does not support anyOf at the top level.',
        http: {
          request: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', headers: {} },
          response: { status: 400, headers: { 'request-id': 'req-safe' } },
          body: '{"type":"invalid_request_error"}',
          requestId: 'req-safe',
        },
      }),
    });

    const entry = threadFailureEntry(
      { id: 'run-1', threadId: 'thread-1', provider: 'subscription' } satisfies Pick<ThreadRunRow, 'id' | 'threadId' | 'provider'>,
      failure,
    );

    expect(entry).toMatchObject({
      type: 'failure',
      id: 'transcript:error:run-1',
      runId: 'run-1',
      diagnostics: {
        provider: 'subscription',
        account: null,
        stage: 'RequestExecutor.execute',
        type: 'InvalidRequest',
        httpStatus: 400,
        retryable: false,
        modelStarted: false,
        record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
      },
    });
    expect(entry.message).toContain('input_schema does not support anyOf');
    expect(entry.diagnostics.detail).toContain('req-safe');
  });

  test('keeps a retryable pre-execution provider capacity failure through durable diagnostics', () => {
    const entry = threadFailureEntry(
      { id: 'run-capacity', threadId: 'thread-1', provider: 'acme-oauth' },
      new LLMError({
        module: 'OpenAIResponses',
        method: 'stream',
        reason: new ProviderInternalReason({
          message: 'The model is currently at capacity due to high demand.',
          modelStarted: false,
        }),
      }),
    );

    expect(entry).toMatchObject({
      message: 'OpenAIResponses.stream: The model is currently at capacity due to high demand.',
      diagnostics: {
        provider: 'acme-oauth',
        stage: 'OpenAIResponses.stream',
        type: 'ProviderInternal',
        retryable: true,
        modelStarted: false,
      },
    });
    expect(parseThreadRunFailure(entry.diagnostics)).toEqual(entry.diagnostics);
  });

  test('a retry ending survives JSON storage beside the final wire failure instead of hiding it', () => {
    const retry = { stop: 'exhausted', attempts: 6, retries: 5, limit: 5 } as const;
    const entry = threadFailureEntry(
      { id: 'run-retried', threadId: 'thread-1', provider: 'openai-oauth' },
      new AgentRetryFailed({
        retry,
        cause: new LLMError({
          module: 'OpenAIResponses',
          method: 'stream',
          reason: new InvalidProviderOutputReason({
            message: 'The stream broke.',
            family: 'torn-stream',
            status: 200,
            upstreamRequestId: 'last-request',
            attempt: 0,
          }),
        }),
      }),
    );
    const stored = parseThreadRunFailure(JSON.parse(JSON.stringify(entry.diagnostics)));
    expect(stored).toMatchObject({
      retry,
      type: 'InvalidProviderOutput',
      stage: 'OpenAIResponses.stream',
      retryable: true,
      reason: { family: 'torn-stream', upstreamRequestId: 'last-request', attempt: 0 },
    });
    expect(entry.message).toContain('5/5');
    expect(entry.message).toContain('The stream broke.');
  });

  test('names a failure that never crossed the provider door by what it is', () => {
    const entry = threadFailureEntry({ id: 'run-2', threadId: 'thread-1', provider: null }, new RangeError('The step budget ran out.'));

    const { stack, ...named } = entry.diagnostics;
    expect(named).toEqual({
      provider: null,
      account: null,
      stage: 'thread',
      type: 'RangeError',
      retryable: null,
      modelStarted: null,
      record: { threadId: 'thread-1', runId: 'run-2', entryId: 'transcript:error:run-2' },
    });
    expect(stack).toContain('RangeError: The step budget ran out.');
    expect(entry.message).toBe('The step budget ran out.');
  });

  test('keeps the wire record of a torn stream through the stored row and back', () => {
    const entry = threadFailureEntry(
      { id: 'run-torn', threadId: 'thread-1', provider: 'openai-oauth' },
      new LLMError({
        module: 'OpenAIResponses',
        method: 'stream',
        reason: new InvalidProviderOutputReason({
          message: 'The stream ended before its terminal event.',
          family: 'torn-stream',
          status: 200,
          upstreamRequestId: 'req_torn',
          attempt: 2,
          bytesRead: 4_096,
          elapsedMs: 1_200,
          lastEvent: { type: 'reasoning-delta', count: 3 },
          cause: [
            { tag: 'Error', message: 'the read was cut' },
            { tag: 'Error', message: 'The socket connection was closed unexpectedly' },
          ],
        }),
      }),
    );

    const reason: WireFailureRecord = {
      family: 'torn-stream',
      status: 200,
      upstreamRequestId: 'req_torn',
      attempt: 2,
      bytesRead: 4_096,
      elapsedMs: 1_200,
      lastEvent: { type: 'reasoning-delta', count: 3 },
      cause: [
        { tag: 'Error', message: 'the read was cut' },
        { tag: 'Error', message: 'The socket connection was closed unexpectedly' },
      ],
    };
    expect(entry.diagnostics.reason).toEqual(reason);
    expect(parseThreadRunFailure(JSON.parse(JSON.stringify(entry.diagnostics)))).toEqual(entry.diagnostics);
  });

  test('keeps the window a stalled call outlasted', () => {
    const entry = threadFailureEntry(
      { id: 'run-stalled', threadId: 'thread-1', provider: 'subscription' },
      new LLMError({
        module: 'RequestExecutor',
        method: 'execute',
        reason: new StreamStalledReason({ message: 'The call said nothing for 120000 ms.', idleMs: 120_000 }),
      }),
    );

    expect(entry.diagnostics.reason).toEqual({ family: 'stalled', idleMs: 120_000 });
  });

  test('writes no wire record for a failure that never reached the wire', () => {
    const entry = threadFailureEntry({ id: 'run-2', threadId: 'thread-1', provider: null }, new RangeError('The step budget ran out.'));

    expect(entry.diagnostics.reason).toBeUndefined();
  });

  test('keeps the account and typed rate-limit window of a refused run', () => {
    const rateLimit = HttpRateLimitDetails.make({
      retryAfterMs: 60_000,
      remaining: { requests: '0' },
      reset: { requests: '60s' },
    });
    const entry = threadFailureEntry(
      { id: 'run-rate', threadId: 'thread-1', provider: 'openai-oauth', account: 'account-1' },
      new LLMError({
        module: 'RequestExecutor',
        method: 'execute',
        reason: new RateLimitReason({ message: 'Too many requests.', retryAfterMs: 60_000, rateLimit }),
      }),
    );

    expect(entry.diagnostics).toMatchObject({
      provider: 'openai-oauth',
      account: 'account-1',
      type: 'RateLimit',
      rateLimit: {
        retryAfterMs: 60_000,
        remaining: { requests: '0' },
        reset: { requests: '60s' },
      },
    });
  });
});
