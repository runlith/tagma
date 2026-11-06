// @vitest-environment jsdom
import { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import type { ThreadSessionStatus } from '@runlith/chat-ui/session/ThreadSession.svelte';
import { flushSync, tick } from 'svelte';
import { expect, test } from 'vitest';
import type { TranscriptSeat } from './ThreadTranscripts.js';
import { TranscriptFollow } from './transcript.js';
import { type Transcript, transcriptReading } from './transcriptReading.svelte.js';

type Raw = Record<string, unknown> & { readonly id: string };

type FeedApply = Parameters<ChatFold['apply']>[0][number];

const message = (id: string, role: 'user' | 'assistant', text: string): Raw => ({ type: 'message', id, role, runId: 'run-1', text });

const tool = (id: string, toolState: string): Raw => ({
  type: 'tool',
  id,
  runId: 'run-1',
  toolName: 'bash',
  toolCallId: id,
  toolState,
  toolInput: { command: 'ls' },
});

const reset = (transcript: readonly Raw[], open: readonly Raw[] = [], before: number | null = null): FeedApply =>
  ({ op: 'reset', transcript, open: open.map((entry) => ({ entry, from: 0 })), before, progress: null }) as never;

const settle = (entry: Raw): FeedApply => ({ op: 'place', placement: { kind: 'replace', entry }, closesOpen: true }) as never;

const append = (entry: Raw): FeedApply => ({ op: 'place', placement: { kind: 'append', entry }, closesOpen: false }) as never;

const grow = (id: string, text: string): FeedApply => ({ op: 'append', id, text }) as never;

const mark = (ids: readonly string[], rewound: { by: string; scope: 'from' } | null): FeedApply =>
  ({ op: 'place', placement: { kind: 'mark', ids, rewound }, closesOpen: false }) as never;

const followed = (apply: FeedApply, count?: number) => {
  const fold = new ChatFold();
  fold.apply([apply]);
  return { fold, follow: new TranscriptFollow('thread-1', fold, count) };
};

test('the newest page lists the entries a person sees, pages back over what is hidden, and says when older ones remain', () => {
  const { fold, follow } = followed(
    reset(
      [
        message('m1', 'user', 'one'),
        { type: 'reasoning', id: 'r1', runId: 'run-1', text: 'thinking' },
        message('m2', 'assistant', 'two'),
        message('m3', 'user', 'three'),
        message('m4', 'assistant', 'four'),
      ],
      [],
      7,
    ),
    2,
  );

  const initial = follow.start();
  expect(initial).toMatchObject({ type: 'initial', threadId: 'thread-1', more: true, tail: [] });
  expect(initial.entries.map((entry) => entry.id)).toEqual(['m3', 'm4']);

  const first = follow.taken(follow.older());
  expect(first.entries.map((entry) => entry.id)).toEqual(['m1', 'm2']);
  expect(first.more).toBe(true);

  fold.prepend([message('m0', 'user', 'zero')] as never, null);
  const last = follow.older();
  expect(last.hungry).toBe(false);
  expect(follow.taken(last)).toMatchObject({ more: false, entries: [{ id: 'm0' }] });
});

test('a reply streams as appended text in the tail and, once finished, arrives as an entry that leaves the tail', () => {
  const { fold, follow } = followed(reset([message('m1', 'user', 'go')], [message('a1', 'assistant', 'He')]));

  const initial = follow.start();
  expect(initial.tail).toMatchObject([{ id: 'a1', role: 'assistant', text: 'He' }]);

  fold.apply([grow('a1', 'llo')]);
  const events = follow.step();
  expect(events).toEqual([{ type: 'tail', threadId: 'thread-1', tail: { restart: false, id: 'a1', text: 'llo' } }]);

  fold.apply([settle(message('a1', 'assistant', 'Hello'))]);
  const done = follow.step();
  expect(done.map((event) => event.type)).toEqual(['entry', 'tail']);
  expect(done[0]).toMatchObject({ entry: { id: 'a1', text: 'Hello' } });
  expect(done[1]).toMatchObject({ tail: { restart: true, entries: [] } });
});

test('a tool call is a tail entry while its input arrives, then a running entry, then a done one in place', () => {
  const { fold, follow } = followed(reset([message('m1', 'user', 'run it')], [tool('t1', 'input-streaming')]));

  expect(follow.start().tail).toMatchObject([{ id: 't1', tool: { name: 'bash', state: 'running' } }]);

  fold.apply([settle(tool('t1', 'input-available'))]);
  expect(follow.step().map((event) => event.type)).toEqual(['entry', 'tail']);

  fold.apply([settle({ ...tool('t1', 'output-available'), toolOutput: 'a b' })]);
  const done = follow.step();
  expect(done).toMatchObject([{ type: 'entry', entry: { id: 't1', role: 'tool', tool: { state: 'done', output: 'a b' } } }]);
});

test('a rewind removes the entries it marks and an undone rewind brings them back', () => {
  const { fold, follow } = followed(
    reset([message('m1', 'user', 'keep'), message('m2', 'assistant', 'old'), message('m3', 'user', 'old too')]),
  );
  follow.start();

  fold.apply([mark(['m2', 'm3'], { by: 'rewind-1', scope: 'from' })]);
  expect(follow.step()).toEqual([{ type: 'removed', threadId: 'thread-1', ids: ['m2', 'm3'] }]);

  fold.apply([mark(['m2', 'm3'], null)]);
  expect(follow.step().map((event) => (event.type === 'entry' ? event.entry.id : event.type))).toEqual(['m2', 'm3']);
});

test('a withdrawn entry is removed, and an entry appended later joins the end', () => {
  const { fold, follow } = followed(reset([message('m1', 'user', 'a'), message('m2', 'assistant', 'b')]));
  follow.start();

  fold.apply([
    { op: 'place', placement: { kind: 'withdraw', ids: ['m2'] }, closesOpen: false } as never,
    append(message('m3', 'user', 'c')),
  ]);

  expect(follow.step()).toMatchObject([
    { type: 'removed', ids: ['m2'] },
    { type: 'entry', entry: { id: 'm3', text: 'c' } },
  ]);
});

test('a question stands as an unanswered entry until it is answered', () => {
  const question: Raw = {
    type: 'question',
    id: 'q1',
    runId: 'run-1',
    questionId: 'ask-1',
    questions: [{ id: 'p1', prompt: 'Which?', toolCallId: 'c1' }],
    toolCalls: [{ toolCallId: 'c1', toolName: 'ask_user' }],
    status: 'open',
  };
  const { fold, follow } = followed(reset([message('m1', 'user', 'hi'), question]));

  expect(follow.start().entries.at(-1)).toMatchObject({ role: 'question', question: { id: 'ask-1', answered: false } });

  fold.apply([settle({ ...question, status: 'answered', answers: [{ questionId: 'p1', values: ['x'] }] })]);
  const events = follow.step();
  expect(events).toMatchObject([{ type: 'entry', entry: { id: 'q1', question: { answered: true } } }]);
});

class Seat implements TranscriptSeat {
  status = $state<ThreadSessionStatus>('ready');
  problem: string | null = null;
  released = 0;
  readonly pages: Raw[][] = [];

  constructor(readonly fold: ChatFold) {}

  older = async () => {
    const page = this.pages.shift();
    if (page === undefined) return false;
    this.fold.prepend(page as never, this.pages.length > 0 ? 1 : null);
    return true;
  };

  release(): void {
    this.released += 1;
  }
}

const read = (seat: Seat) => {
  const transcript = transcriptReading({ take: () => seat }, 1, 't1');
  const stop = $effect.root(() => {
    $effect(() => {
      void transcript.entries;
      void transcript.tail;
    });
  });
  flushSync();
  return { transcript, stop };
};

const shown = (transcript: Transcript) => ({
  entries: transcript.entries.map((entry) => entry.id),
  tail: transcript.tail.map((entry) => entry.text),
});

test('a view reads a thread as it streams, runs a tool, pages back and follows a rewind', async () => {
  const fold = new ChatFold();
  fold.apply([
    reset(
      [message('m1', 'user', 'one'), message('m2', 'assistant', 'two'), message('m3', 'user', 'go')],
      [message('a1', 'assistant', 'He')],
      9,
    ),
  ]);
  const seat = new Seat(fold);
  seat.pages.push([message('m0', 'user', 'zero')]);
  const { transcript, stop } = read(seat);

  expect(shown(transcript)).toEqual({ entries: ['m1', 'm2', 'm3'], tail: ['He'] });
  expect(transcript.more).toBe(true);

  fold.apply([grow('a1', 'llo')]);
  flushSync();
  expect(shown(transcript).tail).toEqual(['Hello']);

  fold.apply([settle(message('a1', 'assistant', 'Hello')), append(tool('t1', 'input-available'))]);
  flushSync();
  fold.apply([settle({ ...tool('t1', 'output-available'), toolOutput: 'a b' })]);
  flushSync();
  expect(transcript.entries.at(-1)).toMatchObject({ id: 't1', tool: { state: 'done', output: 'a b' } });

  await transcript.older();
  expect(shown(transcript).entries).toEqual(['m0', 'm1', 'm2', 'm3', 'a1', 't1']);
  expect(transcript.more).toBe(false);

  fold.apply([mark(['m3', 'a1', 't1'], { by: 'rewind-1', scope: 'from' })]);
  flushSync();
  expect(shown(transcript).entries).toEqual(['m0', 'm1', 'm2']);
  stop();
});

test('a view that stops reading gives the session back, and reading again opens a fresh one', async () => {
  const fold = new ChatFold();
  fold.apply([reset([message('m1', 'user', 'one')])]);
  const seat = new Seat(fold);
  const transcript = transcriptReading({ take: () => seat }, 1, 't1');
  const watch = () => {
    const stop = $effect.root(() => {
      $effect(() => {
        void transcript.entries;
      });
    });
    flushSync();
    return stop;
  };
  watch()();
  await tick();
  expect(seat.released).toBe(1);

  fold.apply([append(message('m2', 'assistant', 'two'))]);
  const stop = watch();
  expect(shown(transcript).entries).toEqual(['m1', 'm2']);
  stop();
  await tick();
  expect(seat.released).toBe(2);
});

test('a thread that fails after its first page says why and gives its session back', () => {
  const fold = new ChatFold();
  fold.apply([reset([message('m1', 'user', 'one')])]);
  const seat = new Seat(fold);
  const { transcript, stop } = read(seat);
  expect(shown(transcript).entries).toEqual(['m1']);

  seat.problem = 'The thread is gone.';
  seat.status = 'failed';
  flushSync();

  expect(transcript.failure).toBe('The thread is gone.');
  expect(seat.released).toBe(1);
  stop();
});
