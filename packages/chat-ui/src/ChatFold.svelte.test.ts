import type { ThreadEventDelta } from '@runlith/agent/transcript/eventFold';
import { describe, expect, test } from 'vitest';
import { ChatFold } from './ChatFold.svelte';
import { FeedReader } from './session/FeedReader';
import { at, openEvent, type SnapshotInput, snapshotEvent, state, stateEvent } from './testing/chatHarness.svelte';

type Raw = Record<string, unknown> & { readonly id: string; readonly type: string };

function opened(input: SnapshotInput = {}) {
  const fold = new ChatFold();
  const reader = new FeedReader(fold);
  reader.read(snapshotEvent({ position: 1, ...input }));
  let seq = input.seq ?? 1;
  let held = input.position ?? 1;
  return {
    fold,
    reader,
    state(next: SnapshotInput, _position: number, records: readonly ThreadEventDelta[] = []) {
      seq += 1;
      held = records.at(-1)?.position ?? held;
      return reader.read(stateEvent(next, at(held, seq), records));
    },
    open(change: Parameters<typeof openEvent>[0]) {
      seq += 1;
      return reader.read(openEvent(change, at(1, seq)));
    },
    skipped(change: Parameters<typeof openEvent>[0]) {
      return reader.read(openEvent(change, at(1, seq + 5)));
    },
  };
}

const message = (id: string, role: 'user' | 'assistant', runId: string, text: string, extra: Record<string, unknown> = {}): Raw => ({
  type: 'message',
  id,
  role,
  runId,
  text,
  ...extra,
});

const tool = (callId: string, runId: string, toolState: string, occurredAt?: string): Raw => ({
  type: 'tool',
  id: `tool:${callId}`,
  runId,
  toolName: 'bash',
  toolCallId: callId,
  toolState,
  occurredAt,
});

const record = (position: number, entry: Raw, kind = entry.type): ThreadEventDelta => ({ position, kind, entry: entry as never });

const ids = (fold: ChatFold) => fold.entries.map((entry) => entry.id);

describe('the chat fold follows the runtime feed', () => {
  test('a snapshot lays the journal and then the open tail, and an open message is streaming', () => {
    const { fold } = opened({
      activeRunId: 'run-1',
      transcript: [message('message:user:run-1', 'user', 'run-1', 'начни')],
      open: [message('assistant:run-1', 'assistant', 'run-1', 'Раз'), tool('a', 'run-1', 'input-streaming')],
    });

    expect(ids(fold)).toEqual(['message:user:run-1', 'assistant:run-1', 'tool:a']);
    expect(fold.entries[1]).toMatchObject({ kind: 'assistant', assistantState: 'streaming' });
  });

  test('a grown text is one patch at its entry and leaves every other entry the object it was', () => {
    const feed = opened({
      activeRunId: 'run-1',
      transcript: [message('message:user:run-1', 'user', 'run-1', 'начни')],
      open: [message('assistant:run-1', 'assistant', 'run-1', 'Раз')],
    });
    const before = feed.fold.entries;
    const seen = feed.fold.revision;

    feed.open({ op: 'append', id: 'assistant:run-1', text: ' два' });

    expect(feed.fold.entries[1]).toMatchObject({ text: 'Раз два' });
    expect(feed.fold.entries[0]).toBe(before[0]);
    const changes = feed.fold.since(seen)!.flat();
    expect(changes).toMatchObject([{ kind: 'patch', at: 1 }]);
  });

  test('an open entry that ends without a record leaves, and a new one lands at the end', () => {
    const feed = opened({ activeRunId: 'run-1', open: [tool('a', 'run-1', 'input-streaming')] });

    feed.open({ op: 'put', entry: tool('b', 'run-1', 'input-available') });
    expect(ids(feed.fold)).toEqual(['tool:a', 'tool:b']);

    feed.open({ op: 'drop', id: 'tool:a' });
    expect(ids(feed.fold)).toEqual(['tool:b']);
  });

  test('a record settles the open entry it names in place, and a new record lands above what stays open', () => {
    const feed = opened({
      activeRunId: 'run-1',
      transcript: [message('message:user:run-1', 'user', 'run-1', 'начни')],
      open: [tool('a', 'run-1', 'input-available'), tool('b', 'run-1', 'input-available')],
    });

    feed.state({ activeRunId: 'run-1' }, 2, [record(2, tool('a', 'run-1', 'output-available'))]);
    expect(feed.fold.entries.find((entry) => entry.id === 'tool:a')).toMatchObject({ toolState: 'output-available' });
    expect(ids(feed.fold)).toEqual(['message:user:run-1', 'tool:a', 'tool:b']);

    feed.state({ activeRunId: 'run-1' }, 3, [
      record(3, { type: 'signal', id: 'transcript:signal:s', runId: 'run-1', signalType: 'message', addressee: 'reader', text: 'hi' }),
    ]);
    expect(ids(feed.fold)).toEqual(['message:user:run-1', 'tool:a', 'transcript:signal:s', 'tool:b']);

    feed.state({ activeRunId: 'run-1' }, 4, [record(4, tool('b', 'run-1', 'output-error'))]);
    feed.open({ op: 'put', entry: tool('c', 'run-1', 'input-available') });
    feed.state({ activeRunId: 'run-1' }, 5, [
      record(5, { type: 'signal', id: 'transcript:signal:t', runId: 'run-1', signalType: 'message', addressee: 'reader', text: 'again' }),
    ]);
    expect(ids(feed.fold).slice(-2)).toEqual(['transcript:signal:t', 'tool:c']);
  });

  test('withdrawing a run removes its open and journaled entries and keeps its system prompt', () => {
    const feed = opened({
      activeRunId: 'run-1',
      transcript: [
        { type: 'system-prompt', id: 'system-prompt:run-1', runId: 'run-1', text: 'prompt' },
        message('message:user:run-1', 'user', 'run-1', 'начни'),
        message('message:user:run-0', 'user', 'run-0', 'раньше'),
      ],
      open: [message('assistant:run-1', 'assistant', 'run-1', 'Раз')],
    });

    feed.state({}, 2, [{ position: 2, kind: 'withdrawal', withdrawn: { runId: 'run-1' } }]);

    expect(ids(feed.fold)).toEqual(['system-prompt:run-1', 'message:user:run-0']);
  });

  test('a rewind marks the entries of its runs and a restore clears the mark', () => {
    const feed = opened({
      transcript: [message('message:user:run-1', 'user', 'run-1', 'раз'), message('message:user:run-2', 'user', 'run-2', 'два')],
    });

    feed.state({}, 2, [{ position: 2, kind: 'rewound', rewound: { id: 'rewind-1', scope: 'from', runIds: ['run-2'] } }]);
    expect(feed.fold.entries.map((entry) => entry.rewound?.by)).toEqual([undefined, 'rewind-1']);

    feed.state({}, 3, [{ position: 3, kind: 'restored', restored: { rewindId: 'rewind-1', runIds: ['run-2'] } }]);
    expect(feed.fold.entries.every((entry) => entry.rewound === undefined)).toBe(true);
  });

  test('one feed event is one batch of changes', () => {
    const feed = opened({ activeRunId: 'run-1', open: [tool('a', 'run-1', 'input-available'), tool('b', 'run-1', 'input-available')] });
    const seen = feed.fold.revision;

    feed.state({ activeRunId: 'run-1' }, 2, [
      record(2, tool('a', 'run-1', 'output-available')),
      record(3, tool('b', 'run-1', 'output-available')),
      record(4, message('assistant:run-1', 'assistant', 'run-1', 'Готово')),
    ]);

    expect(feed.fold.since(seen)).toHaveLength(1);
  });

  test('a frame out of sequence is a gap that changes nothing', () => {
    const feed = opened({ activeRunId: 'run-1', open: [message('assistant:run-1', 'assistant', 'run-1', 'Раз')] });
    const seen = feed.fold.revision;

    const read = feed.skipped({ op: 'append', id: 'assistant:run-1', text: ' два' });

    expect(read).toEqual({ kind: 'gap' });
    expect(feed.fold.revision).toBe(seen);
    expect(feed.fold.entries[0]).toMatchObject({ text: 'Раз' });
  });

  test('a resume applies what the journal gained and replaces the open tail whole', () => {
    const feed = opened({
      activeRunId: 'run-1',
      transcript: [message('message:user:run-1', 'user', 'run-1', 'начни')],
      open: [tool('a', 'run-1', 'input-available'), tool('stale', 'run-1', 'input-available')],
    });

    feed.reader.read({
      type: 'resume',
      at: at(3, 9),
      payload: {
        from: at(1, 1),
        records: [record(2, tool('a', 'run-1', 'output-available')), record(3, message('assistant:run-1', 'assistant', 'run-1', 'Готово'))],
        open: [tool('c', 'run-1', 'input-available')] as never,
        progress: null,
        snapshot: state({ activeRunId: 'run-1' }),
      },
    });

    expect(ids(feed.fold)).toEqual(['message:user:run-1', 'tool:a', 'assistant:run-1', 'tool:c']);
    expect(feed.fold.entries[1]).toMatchObject({ toolState: 'output-available' });
  });

  test('a tool the operation refused carries the producer’s refusal', () => {
    const { fold } = opened({
      transcript: [{ ...tool('r', 'run-1', 'output-refused'), toolRefusal: { code: 'busy', reason: 'Another run holds it.' } }],
    });

    expect(fold.entries[0]).toMatchObject({ kind: 'tool', toolState: 'output-refused', toolRefusal: { code: 'busy' } });
  });
});

describe('the chat fold keeps the words the reader just sent until the runtime records them', () => {
  const echo = (turnKey: string | undefined): Raw => message('message:user:run-1', 'user', 'run-1', 'начни', turnKey ? { turnKey } : {});

  test('an opening survives resets until its record arrives', () => {
    const feed = opened();
    const turn = feed.fold.beginUserMessage({ text: 'начни', turnKey: 'turn-1' });

    feed.reader.read(snapshotEvent({ position: 2, seq: 5 }));
    expect(ids(feed.fold)).toEqual([turn.anchorId]);

    feed.fold.adoptUserMessage(turn, 'run-1');
    feed.reader.read(snapshotEvent({ position: 3, seq: 6 }));
    expect(ids(feed.fold)).toEqual(['message:user:run-1']);

    feed.reader.read(snapshotEvent({ position: 4, seq: 7, transcript: [echo('turn-1')] }));
    expect(ids(feed.fold)).toEqual(['message:user:run-1']);
    expect(feed.fold.pending('message:user:run-1')).toBe(false);
  });

  test('a record carrying the turn key replaces the opening where it stands, before or after the ack', () => {
    for (const acked of [false, true]) {
      const feed = opened();
      const turn = feed.fold.beginUserMessage({ text: 'начни', turnKey: 'turn-1' });
      if (acked) feed.fold.adoptUserMessage(turn, 'run-1');

      feed.state({ activeRunId: 'run-1' }, 2, [record(2, echo('turn-1'))]);

      expect(ids(feed.fold)).toEqual(['message:user:run-1']);
      expect(feed.fold.pending(turn.anchorId!)).toBe(false);
    }
  });

  test('a record of another turn with the same words leaves the opening standing', () => {
    const feed = opened();
    const turn = feed.fold.beginUserMessage({ text: 'начни', turnKey: 'turn-1' });

    feed.state({ activeRunId: 'run-1' }, 2, [record(2, echo('user-other-tab'))]);

    expect(ids(feed.fold)).toEqual(['message:user:run-1', turn.anchorId]);
  });

  test('a rolled-back opening leaves nothing behind for a reset to keep', () => {
    const feed = opened();
    const turn = feed.fold.beginUserMessage({ text: 'начни', turnKey: 'turn-1' });
    feed.fold.retract(turn);

    feed.reader.read(snapshotEvent({ position: 2, seq: 5 }));

    expect(feed.fold.entries).toHaveLength(0);
  });

  test('an unconfirmed opening is marked and keeps its place', () => {
    const feed = opened();
    const turn = feed.fold.beginUserMessage({ text: 'начни', turnKey: 'turn-1' });

    feed.fold.unconfirmed(turn);

    expect(feed.fold.entries[0]).toMatchObject({ kind: 'user', unconfirmed: true });
  });
});

describe('the chat fold draws words once the journal reads them', () => {
  test('a steer shows from the state event that journals it, once', () => {
    const feed = opened({ activeRunId: 'run-1' });
    const steer = {
      type: 'signal',
      id: 'transcript:signal:steer-1',
      runId: 'run-1',
      signalType: 'user-message',
      addressee: 'reader',
      text: 'ещё',
    };

    feed.state({ activeRunId: 'run-1' }, 2, [record(2, steer)]);

    expect(ids(feed.fold)).toEqual(['transcript:signal:steer-1']);
  });
});

describe('the chat fold hands out what changed', () => {
  test('a change set the log no longer holds is answered as unknown, never as empty', () => {
    const fold = new ChatFold();
    const origin = fold.revision;
    for (let step = 0; step < 40; step += 1) fold.beginUserMessage({ text: `m${step}`, turnKey: `k${step}` });

    expect(fold.since(origin)).toBeNull();
    expect(fold.since(fold.revision)).toEqual([]);
  });

  test('the index of each kind follows a row withdrawn near the top and a page landing above', () => {
    const feed = opened({
      transcript: Array.from({ length: 6 }, (_, index) =>
        message(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `run-${index}`, `t${index}`),
      ),
    });
    const kinds = () => ({
      user: feed.fold.index.of('user').map((entry) => entry.id),
      assistant: feed.fold.index.of('assistant').map((entry) => entry.id),
    });

    feed.state({}, 2, [{ position: 2, kind: 'withdrawal', withdrawn: { runId: 'run-0' } }]);
    feed.fold.prepend([message('m-older', 'user', 'run-older', 'раньше')] as never, null);

    expect(kinds()).toEqual({ user: ['m-older', 'm2', 'm4'], assistant: ['m1', 'm3', 'm5'] });
  });

  test('a turn opens once: at its first task when agents opened it, never again at the words said after', () => {
    const task = (id: string, runId: string): Raw => ({
      type: 'signal',
      id,
      runId,
      signalType: 'task',
      addressee: 'transport',
      text: id,
      title: 'lead',
      senderThreadId: 'thread-lead',
    });
    const feed = opened({
      transcript: [
        message('m0', 'user', 'run-0', 'first'),
        task('t1', 'run-1'),
        task('t2', 'run-1'),
        message('m1', 'user', 'run-1', 'also'),
      ],
    });
    expect(['m0', 't1', 't2', 'm1'].map((id) => feed.fold.opensRun(id))).toEqual([true, true, false, false]);
  });
});

describe('the chat fold shows an answer being sent until the runtime records one', () => {
  const question = {
    type: 'question',
    id: 'question-1',
    runId: 'run-1',
    questionId: 'q-1',
    status: 'open',
    toolCalls: [{ toolCallId: 'c-1', toolName: 'ask' }],
    questions: [{ id: 'p-1', toolCallId: 'c-1', kind: 'choice', prompt: 'which?' }],
  };
  const sent = { key: 'k-1', answers: [{ questionId: 'p-1', values: ['a'] }], unconfirmed: false };

  test('a fresh snapshot keeps the answer sending while the question still asks, and a withdrawn answer reopens it', () => {
    const { fold, reader } = opened({ activeRunId: 'run-1', transcript: [question as Raw] });
    fold.sendAnswer('q-1', sent);
    expect(fold.openQuestion).toBe(false);

    reader.read(snapshotEvent({ position: 2, activeRunId: 'run-1', transcript: [question as Raw] }));
    expect(fold.entries[0]).toMatchObject({ sending: sent });
    expect(fold.settledAnswers()).toEqual([]);

    fold.withdrawAnswer('k-1');
    expect(fold.openQuestion).toBe(true);
  });

  test('the answer the runtime records wins over the one being sent', () => {
    const { fold, reader } = opened({ activeRunId: 'run-1', transcript: [question as Raw] });
    fold.sendAnswer('q-1', sent);
    const recorded = { ...question, status: 'answered', answers: [{ questionId: 'p-1', values: ['b'] }] };
    reader.read(snapshotEvent({ position: 2, activeRunId: 'run-1', transcript: [recorded as Raw] }));
    expect(fold.entries[0]).toMatchObject({ answers: [{ questionId: 'p-1', values: ['b'] }] });
    expect(fold.settledAnswers()).toEqual(['k-1']);
  });
});
