import { describe, expect, test } from 'bun:test';
import type { ThreadInboxItem } from './storage/inbox';
import { queuedTurnText } from './inboxItems';

describe('queuedTurnText', () => {
  const words: ThreadInboxItem = {
    id: 'input-1',
    threadId: 'thread-1',
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: 'and check the second file too' },
    state: 'queued',
    deliveredToRunId: null,
    occurredAt: '2026-06-26T10:00:00.000Z',
  };
  const task: ThreadInboxItem = {
    id: 'envelope:task',
    threadId: 'thread-1',
    sender: { kind: 'thread', threadId: 'thread-parent', name: 'orchestrator' },
    kind: 'task',
    body: { intent: 'task', text: 'read the diff', inReplyTo: null },
    state: 'queued',
    deliveredToRunId: null,
    occurredAt: '2026-06-26T10:00:01.000Z',
  };

  test('a person`s words stand as they were typed', () => {
    expect(queuedTurnText([words])).toBe('and check the second file too');
  });

  test('a task keeps the markup that names its sender and its receipt', () => {
    expect(queuedTurnText([task])).toBe('<task from="orchestrator" thread="thread-parent" envelope="envelope:task">read the diff</task>');
  });

  test('an interrupt reason keeps its markup and its sender', () => {
    const interrupt: ThreadInboxItem = {
      ...task,
      id: 'envelope:interrupt',
      body: { intent: 'interrupt', text: 'stop and read the new brief', inReplyTo: null },
    };
    expect(queuedTurnText([interrupt])).toBe(
      '<interrupt from="orchestrator" thread="thread-parent" envelope="envelope:interrupt">stop and read the new brief</interrupt>',
    );
  });

  test('a turn carrying both says which words are whose', () => {
    expect(queuedTurnText([words, task]).split('\n')).toEqual([
      'and check the second file too',
      '<task from="orchestrator" thread="thread-parent" envelope="envelope:task">read the diff</task>',
    ]);
  });
});
