import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { threadOpenChangeSchema } from '@runlith/agent/protocol/http';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import type { ThreadListRow } from '../contract/wire/list.js';
import type { ThreadToolAnswer } from '../contract/wire/evidenceInput.js';
import { threadSettledDisplay } from './display.js';
import { threadToolText } from './answers.js';

const row: ThreadListRow = {
  id: 'thread-1',
  projectId: 5,
  scopeName: null,
  title: 'Review',
  titleOrigin: 'agent',
  life: 'idle',
  activeRunId: null,
  activeRunStartedAt: null,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: null,
  outcome: null,
  spawnRootId: 'thread-1',
  parentThreadId: null,
  name: 'reviewer',
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  account: null,
  provider: 'openai-oauth',
  model: 'gpt-6.1-sol',
  reasoning: 'high',
  switches: {},
  createdBySessionId: null,
  readerOrderAt: '2026-10-01T00:00:00.000Z',
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

test('a full thread page reads as its rows with the cursor that continues it, and its display decodes inside a live open change', () => {
  for (const rows of [[], [row]]) {
    const answer: ThreadToolAnswer = { status: 'rows', rows, total: 2, before: 'next-page' };
    const display = threadSettledDisplay({}, answer);
    const entry = {
      type: 'tool',
      id: 'tool:list-call',
      toolName: 'list',
      toolCallId: 'list-call',
      toolState: 'output-available',
      toolDisplay: display,
    };
    const change = Schema.decodeUnknownSync(threadOpenChangeSchema)(JSON.parse(JSON.stringify({ op: 'put', entry })));
    expect(change).toEqual({ op: 'put', entry });
    expect(display?.facts?.[0]?.value).toBe(String(rows.length));
    const text = threadToolText(answer) ?? '';
    expect(text).toContain('next-page');
    for (const shown of rows) expect(text).toContain(shown.id);
  }
});
