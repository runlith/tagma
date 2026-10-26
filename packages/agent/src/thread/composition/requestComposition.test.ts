import { describe, expect, test } from 'bun:test';
import { Message } from '@runlith/llm/schema/messages';
import { agentRuntimeGuidanceMessage, agentSignalMessage, withAgentOrigin } from '../../agent/AgentSignal';
import { THREAD_COMPOSITION_PARTS, type ThreadCompositionPartId } from '../../protocol/compositionParts';
import { threadRequestComposition, type ThreadCompositionInput } from './requestComposition';

const CLEARED = '[tool output cleared]';

const LEDGER = {
  runs: 2,
  compactions: 1,
  inputTokens: 300,
  outputTokens: 40,
  cacheReadTokens: 250,
  cacheWriteTokens: 20,
};

function composition(over: Partial<ThreadCompositionInput> = {}) {
  return threadRequestComposition({
    threadId: 'thread-1',
    history: [],
    fixed: {
      systemChars: 4_000,
      tools: [
        { name: 'read', chars: 800 },
        { name: 'edit', chars: 1_200 },
      ],
    },
    clearedMarker: CLEARED,
    cleared: { count: 0, tokens: 0 },
    share: 0.2,
    protectTokens: 180_000,
    nextPruneAtTokens: 270_000,
    ledger: LEDGER,
    billedInput: 10_000,
    estimatedTotal: 9_000,
    ...over,
  });
}

function tokensOf(parts: readonly { id: ThreadCompositionPartId; tokens: number }[], id: ThreadCompositionPartId) {
  return parts.find((part) => part.id === id)?.tokens ?? 0;
}

function countOf(parts: readonly { id: ThreadCompositionPartId; count: number }[], id: ThreadCompositionPartId) {
  return parts.find((part) => part.id === id)?.count ?? 0;
}

const EVERY_KIND: readonly Message[] = [
  Message.user('What is in this repository?'),
  withAgentOrigin(Message.user('<workspace>the checkout moved</workspace>'), 'orientation'),
  agentRuntimeGuidanceMessage('Read the graph first.'),
  agentSignalMessage({ id: 'signal-1', type: 'message', text: 'Please review it.', occurredAt: '2026-09-02T10:00:00Z' }),
  Message.make({
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'The owner is the harness.' },
      { type: 'text', text: 'Reading the harness now.' },
      { type: 'tool-call', id: 'call-1', name: 'read', input: { path: 'a.ts' } },
    ],
  }),
  Message.tool({ id: 'call-1', name: 'read', result: 'the file, whole' }),
  withAgentOrigin(Message.user('The conversation so far was folded.'), 'summary'),
  withAgentOrigin(Message.assistant('## Objective\n- Continue.'), 'summary'),
];

describe('the request composition', () => {
  test('every part of the request is a row, and the rows sum to the total', () => {
    const answer = composition({ history: EVERY_KIND });

    expect(answer.parts.map((part) => part.id)).toEqual([...THREAD_COMPOSITION_PARTS]);
    expect(answer.parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(answer.total);
    expect(answer.total).toBe(10_000);
    expect(answer.reading).toBe('measured');
  });

  test('what the runtime injected is counted as itself, not as the operator writing', () => {
    const parts = composition({ history: EVERY_KIND }).parts;

    expect(countOf(parts, 'user')).toBe(1);
    expect(countOf(parts, 'orientation')).toBe(1);
    expect(countOf(parts, 'guidance')).toBe(1);
    expect(countOf(parts, 'envelope')).toBe(1);
    expect(countOf(parts, 'summary')).toBe(2);
    expect(countOf(parts, 'reasoning')).toBe(1);
    expect(countOf(parts, 'toolCall')).toBe(1);
    expect(countOf(parts, 'toolOutput')).toBe(1);
    for (const id of ['user', 'orientation', 'guidance', 'envelope', 'summary'] as const) {
      expect(tokensOf(parts, id)).toBeGreaterThan(0);
    }
  });

  test('a cleared result is not a live output, though its marker still stands in the window', () => {
    const live = Message.tool({ id: 'call-1', name: 'read', result: 'the file, whole', resultType: 'text' });
    const gone = Message.tool({ id: 'call-2', name: 'read', result: CLEARED, resultType: 'text' });
    const answer = composition({
      history: [Message.user('go'), live, gone],
      cleared: { count: 1, tokens: 4_200 },
    });

    expect(countOf(answer.parts, 'toolOutput')).toBe(1);
    expect(answer.cleared).toEqual({ count: 1, tokens: 4_200 });
  });

  test('the tool schemas are the heaviest first, and priced off the same total', () => {
    const answer = composition({ history: [Message.user('go')] });

    expect(answer.tools.map((tool) => tool.name)).toEqual(['edit', 'read']);
    expect(answer.tools.reduce((sum, tool) => sum + tool.tokens, 0)).toBeCloseTo(tokensOf(answer.parts, 'tools'), -1);
  });

  test('the orientation splits only where the product named its sections', () => {
    const named = withAgentOrigin(Message.user('<workspace/><graph/>'), 'orientation');
    const declared = Message.make({
      ...named,
      metadata: {
        ...named.metadata,
        parts: [
          { name: 'Workspace', chars: 300 },
          { name: 'Graph', chars: 900 },
        ],
      },
    });

    expect(composition({ history: [declared] }).orientation.map((section) => section.name)).toEqual(['Graph', 'Workspace']);
    expect(composition({ history: [named] }).orientation).toEqual([]);
  });

  test('the tool calls the window still holds are counted by tool, heaviest first', () => {
    const call = (id: string, name: string): Message =>
      Message.make({ role: 'assistant', content: [{ type: 'tool-call', id, name, input: {} }] });
    const answer = composition({
      history: [call('a', 'read'), call('b', 'read'), call('c', 'edit'), call('d', 'read')],
    });

    expect(answer.ledger.toolCalls).toEqual([
      { name: 'read', count: 3 },
      { name: 'edit', count: 1 },
    ]);
    expect(answer.ledger.runs).toBe(2);
    expect(answer.ledger.compactions).toBe(1);
  });

  test('a thread nobody has billed is answered as estimated, and says so', () => {
    const answer = composition({ history: [Message.user('go')], billedInput: null, estimatedTotal: 9_000 });

    expect(answer.reading).toBe('estimated');
    expect(answer.total).toBe(9_000);
    expect(answer.parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(9_000);
  });

  test('the pruning standing states the live output against the share in force', () => {
    const answer = composition({
      history: [Message.tool({ id: 'call-1', name: 'read', result: 'x'.repeat(4_000) })],
    });

    expect(answer.pruning.share).toBe(0.2);
    expect(answer.pruning.protectedTokens).toBe(180_000);
    expect(answer.pruning.nextPruneAtTokens).toBe(270_000);
    expect(answer.pruning.liveToolOutputTokens).toBe(tokensOf(answer.parts, 'toolOutput'));
  });

  test('a deferred schema rides the request as a name until a search in the history revealed it', () => {
    const fixed = {
      systemChars: 4_000,
      tools: [
        { name: 'read', chars: 800 },
        { name: 'mcp__files__search', chars: 1_200, hidden: true as const },
      ],
    };
    const hidden = composition({ history: [Message.user('go')], fixed });
    expect(hidden.tools.map((tool) => tool.name)).toEqual(['read']);
    expect(countOf(hidden.parts, 'tools')).toBe(1);
    expect(hidden.deferredTools).toEqual(['mcp__files__search']);

    const revealed = composition({
      history: [
        Message.user('go'),
        Message.tool({
          id: 'call-1',
          name: 'tool_search',
          result: {
            status: 'revealed',
            tools: [{ name: 'mcp__files__search', description: 'Search.' }],
            missing: [],
            truncated: [],
            note: '',
          },
          resultType: 'json',
        }),
      ],
      fixed,
    });
    expect(revealed.tools.map((tool) => tool.name)).toEqual(['mcp__files__search', 'read']);
    expect(countOf(revealed.parts, 'tools')).toBe(2);
    expect(revealed.deferredTools).toEqual([]);
  });

  test('a thread with no history and no runs answers zeros rather than nothing', () => {
    const answer = composition({ history: [], fixed: null, billedInput: null, estimatedTotal: 0 });

    expect(answer.total).toBe(0);
    expect(answer.parts.every((part) => part.tokens === 0 && part.count === 0)).toBe(true);
    expect(answer.tools).toEqual([]);
  });
});
