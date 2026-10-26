import type { ThreadSignalEntry } from '@runlith/agent/transcript/entries';
import { describe, expect, test } from 'vitest';
import type { ChatEntry } from './entries';
import { entryFromTranscript } from './entryProjection';
import { pickerIntent, rewindChip, rewindTargets, trailingFailedTurns } from './rewind';

const user = (runId: string, rewound?: ChatEntry['rewound']): ChatEntry => ({
  id: `u-${runId}`,
  kind: 'user',
  text: `words of ${runId}`,
  runId,
  rewound,
});
const failed = (runId: string): ChatEntry => ({
  id: `e-${runId}`,
  kind: 'error',
  runId,
  text: 'refused',
  diagnostics: {} as Extract<ChatEntry, { kind: 'error' }>['diagnostics'],
});
const answer = (runId: string): ChatEntry => ({ id: `a-${runId}`, kind: 'assistant', text: 'ok', runId });

describe('which turns a rewind reaches', () => {
  test('a turn another agent’s tasks opened is reached once, like the operator’s; words said into a running turn open none', () => {
    const said = (id: string, runId: string, entry: Partial<ThreadSignalEntry>) =>
      entryFromTranscript({ type: 'signal', id, runId, signalType: 'message', addressee: 'transport', text: id, ...entry });
    const lead = { title: 'lead', senderThreadId: 'thread-lead' };
    const targets = rewindTargets([
      user('run-1'),
      ...said('steer', 'run-1', { addressee: 'reader', signalType: 'user-message' }),
      ...said('task', 'run-2', { ...lead, signalType: 'task' }),
      ...said('next task', 'run-2', { ...lead, signalType: 'task' }),
      ...said('note', 'run-2', lead),
      answer('run-2'),
    ]);

    expect(targets.map((target) => [target.runId, target.entryId, target.ordinal])).toEqual([
      ['run-1', 'u-run-1', 1],
      ['run-2', 'task', 2],
    ]);
  });

  test('the failed turns ending the thread are counted back to the last one that answered, and a rewind starts at the first of them', () => {
    const targets = rewindTargets([
      user('run-1'),
      answer('run-1'),
      user('run-2'),
      failed('run-2'),
      user('run-3'),
      failed('run-3'),
      user('run-4'),
      failed('run-4'),
    ]);

    expect(trailingFailedTurns(targets)).toEqual({ at: 'run-2', count: 3 });
  });

  test('a thread whose newest turn answered, or whose failures are already rewound, has no failed tail', () => {
    expect(trailingFailedTurns(rewindTargets([user('run-1'), failed('run-1'), user('run-2'), answer('run-2')]))).toBeNull();
    const mark = { by: 'rw', scope: 'from' as const };
    expect(trailingFailedTurns(rewindTargets([user('run-1'), answer('run-1'), user('run-2', mark), failed('run-2')]))).toBeNull();
  });

  test('the chip names the earliest restorable rewind of the rest of the thread by its message ordinal; a dropped turn names none', () => {
    const outer = { by: 'outer', scope: 'from' as const };
    const inner = { by: 'inner', scope: 'from' as const };
    const targets = rewindTargets([user('run-1'), user('run-2', outer), user('run-3', inner)]);

    expect(rewindChip(targets, () => true)).toEqual({ rewindId: 'outer', ordinal: 2 });
    expect(rewindChip(targets, (id) => id === 'inner')).toEqual({ rewindId: 'inner', ordinal: 3 });
    expect(rewindChip(rewindTargets([user('run-1', { by: 'drop', scope: 'turn' })]), () => true)).toBeNull();
  });
});

describe('what a press means while the rewind picker is open', () => {
  const press = (key: string, held: { metaKey?: boolean; shiftKey?: boolean } = {}) => ({
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    ...held,
  });

  test('arrows walk, Enter rewinds, B branches and Escape closes; a modified letter is the browser’s', () => {
    expect(['ArrowDown', 'ArrowUp', 'Enter', 'B', 'Escape'].map((key) => pickerIntent(press(key)))).toEqual([
      'next',
      'previous',
      'rewind',
      'branch',
      'close',
    ]);
    expect(pickerIntent(press('b', { metaKey: true }))).toBe('none');
  });

  test('Tab walks the picker instead of leaving the field, Shift+Tab back', () => {
    expect(pickerIntent(press('Tab'))).toBe('next');
    expect(pickerIntent(press('Tab', { shiftKey: true }))).toBe('previous');
  });
});
