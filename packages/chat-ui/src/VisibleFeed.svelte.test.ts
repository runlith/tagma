// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { THREAD_TOOL_CONFIRM_KIND } from '@runlith/agent/transcript/parts';
import { builtinEntryKinds } from './builtinKinds';
import { ChatFold } from './ChatFold.svelte';
import type { ChatEntry } from './entries';
import { VisibleFeed } from './VisibleFeed';

const confirmation = {
  id: 'q',
  kind: 'question',
  runId: 'run-1',
  questionId: 'call-1',
  toolCalls: [{ toolCallId: 'call-1', toolName: 'submit_work' }],
  prompts: [{ id: 'call-1', toolCallId: 'call-1', kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'Commit?' }],
} as ChatEntry;

test('a failed run whose failure the feed shows does not end with a second line saying it failed', () => {
  const fold = new ChatFold();
  const feed = new VisibleFeed(builtinEntryKinds());
  const at = '2026-10-24T18:29:00.000Z';
  const user = { id: 'u', kind: 'user', text: 'go', runId: 'run-1' } as ChatEntry;
  const ended = {
    id: 'end',
    kind: 'run-end',
    runId: 'run-1',
    status: 'failed',
    startedAt: at,
    finishedAt: at,
    occurredAt: at,
  } as ChatEntry;
  const failure = {
    id: 'error',
    kind: 'error',
    runId: 'run-1',
    text: 'HTTP 401',
    diagnostics: {
      provider: null,
      account: null,
      stage: 'thread',
      type: 'Authentication',
      retryable: false,
      modelStarted: false,
      record: { threadId: 't', runId: 'run-1', entryId: 'error' },
    },
  } as ChatEntry;
  const stop = $effect.root(() => {
    $effect.pre(() => feed.sync(fold, false, null));
  });
  fold.entries = [user, ended];
  flushSync();
  expect(feed.rows.slice().map((row) => row.id)).toEqual(['u', 'end']);

  fold.entries = [user, failure, ended];
  flushSync();
  expect(feed.rows.slice().map((row) => row.id)).toEqual(['u', 'error']);
  stop();
});

test('a feed synced from an effect keeps following its fold after a run-only rerun', () => {
  const fold = new ChatFold();
  const feed = new VisibleFeed(builtinEntryKinds());
  let phase = $state<'working' | 'awaiting'>('working');
  const stop = $effect.root(() => {
    $effect.pre(() => feed.sync(fold, false, { id: 'run-1', phase }));
  });
  fold.entries = [{ id: 'u', kind: 'user', text: 'go', runId: 'run-1' } as ChatEntry, confirmation];
  flushSync();
  expect(feed.confirmations).toHaveLength(1);

  phase = 'awaiting';
  flushSync();
  fold.sendAnswer('call-1', { key: 'answer-1', answers: [{ questionId: 'call-1', values: ['confirm'] }], unconfirmed: false });
  flushSync();

  expect(feed.confirmations).toHaveLength(0);
  stop();
});
