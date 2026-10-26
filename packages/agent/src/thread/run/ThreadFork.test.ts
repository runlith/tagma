import { describe, expect, test } from 'bun:test';
import { Message } from '@runlith/llm/schema/messages';
import { forkCut } from './ThreadBranch';
import { branchedTranscript } from '../storage/aggregate';
import type { ThreadForkCut } from '../record';
import type { ThreadHistory } from '../rows';
import type { ThreadTranscript } from '../../transcript/rows';

describe('forkCut', () => {
  const history: ThreadHistory = [
    Message.user('one'),
    Message.assistant('answer one'),
    Message.user('two'),
    Message.assistant('answer two'),
    Message.user('three'),
    Message.assistant('answer three'),
  ];
  const transcript: ThreadTranscript = [
    { type: 'message', id: 'u1', role: 'user', text: 'one' },
    { type: 'message', id: 'a1', role: 'assistant', text: 'answer one' },
    { type: 'message', id: 'u2', role: 'user', text: 'two' },
    { type: 'tool', id: 't2' },
    { type: 'message', id: 'a2', role: 'assistant', text: 'answer two' },
    { type: 'signal', id: 's3', signalType: 'task', addressee: 'transport', text: 'three', title: 'parent' },
    { type: 'message', id: 'a3', role: 'assistant', text: 'answer three' },
  ];
  const carried = (cut: Exclude<ThreadForkCut, { kind: 'before' }>) => {
    const planned = forkCut(history, cut);
    return {
      history: planned.history,
      transcript: branchedTranscript(transcript, planned.entries, 'kept'),
    };
  };

  test('all carries the conversation whole', () => {
    expect(carried({ kind: 'all' })).toEqual({ history, transcript });
  });

  test('none carries nothing at all', () => {
    expect(carried({ kind: 'none' })).toEqual({ history: [], transcript: [] });
  });

  test('a count carries the last turns, opening on the words that started them, a task among them', () => {
    const cut = carried({ kind: 'turns', turns: 2 });

    expect(cut.history.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(cut.transcript.map((entry) => entry.id)).toEqual(['u2', 't2', 'a2', 's3', 'a3']);
  });

  test('a count wider than the conversation carries all of it', () => {
    expect(carried({ kind: 'turns', turns: 9 })).toEqual({ history, transcript });
  });
});
