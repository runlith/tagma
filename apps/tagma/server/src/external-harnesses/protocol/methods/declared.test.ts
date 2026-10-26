import { expect, test } from 'bun:test';
import type { ClientEvent } from '@runlith/acp/events';
import { freshRow } from '../row.js';
import { read } from './declared.js';

const AT = '2026-10-04T12:00:00.000Z';
const row = {
  ...freshRow('process', null, null),
  turns: [
    {
      id: 'turn-1',
      startedAt: AT,
      parts: { text: 0, reasoning: 0 },
      assistant: [],
      said: '',
      words: 'go',
      recorded: true,
    },
  ],
};

const boundaries = (event: ClientEvent) => {
  const declared = read(row, event, AT);
  return declared?._tag === 'Handled' ? declared.handled.boundaries : [];
};

test('compactions the agent made on its own within a turn keep distinct boundaries, summaries and measured sizes', () => {
  expect([
    ...boundaries({
      _tag: 'Extended',
      id: 'process:80',
      method: '_tagma/compacted',
      params: { sessionId: 's', trigger: 'manual', preTokens: 400, postTokens: 120, summary: 'First summary' },
    }),
    ...boundaries({
      _tag: 'Extended',
      id: 'process:90',
      method: '_tagma/compacted',
      params: { sessionId: 's', trigger: 'auto', preTokens: 800, postTokens: null, summary: 'Second summary' },
    }),
  ]).toMatchObject([
    {
      type: 'compaction',
      id: 'compaction:process:80',
      runId: 'turn-1',
      mode: 'manual',
      summary: 'First summary',
      receipt: { measuredTokens: 400, postTokens: 120 },
    },
    {
      type: 'compaction',
      id: 'compaction:process:90',
      runId: 'turn-1',
      mode: 'automatic',
      summary: 'Second summary',
      receipt: { measuredTokens: 800 },
    },
  ]);
});

test('an answer to an extension Tagma declares no handler for is noise, not a reaction', () => {
  const request = { id: '7', admitted: true, uncertain: false, meaning: 'extension', method: '_tagma/unknown', envelopes: [] } as const;
  expect(read(row, { _tag: 'ExtensionAnswered', request, result: {} }, AT)).toEqual({ _tag: 'Undeclared', method: '_tagma/unknown' });
});
