import type { ChatRunEnding } from '@runlith/chat-ui/session/FeedVerdicts';
import { expect, test } from 'vitest';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { servedProvider } from '$lib/features/providers/testing.js';
import { failureNeed, runEndingLine } from './runEndingLine.js';

const MODELS = modelCatalog([
  servedProvider({
    id: 'subscription',
    label: 'Anthropic OAuth',
    models: {
      'claude-opus-5': {
        label: 'Claude Opus 5',
        short: 'Opus',
        capacity: { context: 200_000 },
        capabilities: ['text'],
        reasoning: ['xhigh'],
        defaultReasoning: 'xhigh',
      },
    },
    defaultTextModel: 'claude-opus-5',
  }),
]);

const FINISHED_AT = '2026-01-01T00:04:00.000Z';

function failed(input: Partial<NonNullable<ChatRunEnding['failure']>> = {}, words: string | null = null): ChatRunEnding {
  return {
    kind: 'failed',
    runId: 'run-1',
    words,
    failure: {
      provider: 'subscription',
      account: null,
      stage: 'AgentRunner.step',
      type: 'RateLimit',
      retryable: true,
      modelStarted: false,
      record: { threadId: 'thread-1', runId: 'run-1', entryId: 'transcript:error:run-1' },
      ...input,
    },
    finishedAt: FINISHED_AT,
    provider: 'subscription',
    model: 'claude-opus-5',
    reasoning: 'xhigh',
  };
}

test('a dated rate limit names the provider, the family, the status and the window', () => {
  const line = runEndingLine(
    MODELS,
    failed({ httpStatus: 429, reason: { family: 'rate-limit', status: 429 }, rateLimit: { retryAfterMs: 43 * 60_000 } }),
    Date.parse(FINISHED_AT),
  );

  expect(line).toEqual({ tone: 'failure', text: 'Anthropic OAuth is rate-limiting this account', detail: 'resets in 43m' });
});

test('a window already past says it should be open, and promises nothing', () => {
  const line = runEndingLine(
    MODELS,
    failed({ reason: { family: 'rate-limit' }, rateLimit: { retryAfterMs: 60_000 } }),
    Date.parse(FINISHED_AT) + 5 * 60_000,
  );

  expect(line.detail).toBe('the window should be open');
});

test('a failure the provider did not date has no countdown', () => {
  const line = runEndingLine(MODELS, failed({ reason: { family: 'auth', status: 401 }, httpStatus: 401 }), Date.parse(FINISHED_AT));

  expect(line).toEqual({ tone: 'failure', text: 'Anthropic OAuth did not accept the sign-in', detail: null });
});

test('a refused credential says whether it expired, and asks for the act that renews it', () => {
  const expired = failed({ reason: { family: 'auth', status: 401, kind: 'expired' }, httpStatus: 401 });
  expect(runEndingLine(MODELS, expired, Date.parse(FINISHED_AT)).text).toBe('Anthropic OAuth sign-in has expired');
  expect(failureNeed(MODELS, expired.failure)).toBe('sign-in');
  expect(failureNeed(MODELS, failed({ reason: { family: 'rate-limit' } }).failure)).toBeNull();
});

test('a failure with no wire family speaks the row’s reason, then its type', () => {
  expect(runEndingLine(MODELS, failed({ type: 'HostFailed' }, 'the host port rejected'), Date.parse(FINISHED_AT)).text).toBe(
    'Run failed — the host port rejected',
  );
  expect(runEndingLine(MODELS, failed({ type: 'HostFailed' }), Date.parse(FINISHED_AT)).text).toBe('Run failed — HostFailed');
  expect(runEndingLine(MODELS, { ...failed(), failure: null, words: null }, Date.parse(FINISHED_AT)).text).toBe(
    'Run failed — the run broke before finishing',
  );
});

test('a cut speaks the marker, or plain words when the row wrote none', () => {
  const base: ChatRunEnding = {
    kind: 'cut',
    runId: 'run-1',
    words: null,
    failure: null,
    finishedAt: FINISHED_AT,
    provider: null,
    model: null,
    reasoning: null,
  };

  expect(runEndingLine(MODELS, { ...base, words: 'The process left while this run was working.' }, 0)).toEqual({
    tone: 'interrupted',
    text: 'The process left while this run was working.',
    detail: null,
  });
  expect(runEndingLine(MODELS, base, 0).text).toBe('This work stopped before it was finished.');
});
