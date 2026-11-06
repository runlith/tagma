// @vitest-environment jsdom
import { TRANSCRIPT_CHANGED } from '@tagma/server/views/contract/wire/bridge';
import { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import type { ThreadSessionStatus } from '@runlith/chat-ui/session/ThreadSession.svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type ViewCall, ViewBridge, type ViewParams } from '../views/ViewBridge.js';
import { pluginHost } from './pluginHost.svelte.js';
import type { TranscriptPort, TranscriptSeat } from './ThreadTranscripts.js';
import { TranscriptFollow } from './transcript.js';

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

const mounted = (seat: Seat) => {
  const port: TranscriptPort = { take: () => seat };
  const host = pluginHost({ transcripts: port, methods: [] } as unknown as Parameters<typeof pluginHost>[0], {
    projectId: 1,
    plugin: 'poker',
    view: 'table',
    threadId: null,
    key: null,
  });
  const told: ViewParams[] = [];
  const mount = new AbortController();
  const call = (): ViewCall => ({
    signal: new AbortController().signal,
    mounted: mount.signal,
    notify: (method, params) => {
      if (method === TRANSCRIPT_CHANGED) told.push(params);
    },
  });
  return { host, told, mount, call };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a mounted view lists a thread, sees the reply stream and a tool run, pages back, and follows a rewind', async () => {
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
  const { host, told, call } = mounted(seat);

  const reading = host.methods['tagma/transcript']!({ threadId: 't1' }, call());
  flushSync();
  expect(await reading).toMatchObject({
    type: 'initial',
    more: true,
    entries: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    tail: [{ id: 'a1', text: 'He' }],
  });
  await vi.advanceTimersByTimeAsync(0);

  fold.apply([grow('a1', 'llo')]);
  flushSync();
  fold.apply([settle(message('a1', 'assistant', 'Hello')), append(tool('t1', 'input-available'))]);
  flushSync();
  fold.apply([settle({ ...tool('t1', 'output-available'), toolOutput: 'a b' })]);
  flushSync();
  fold.apply([mark(['m3', 'a1', 't1'], { by: 'rewind-1', scope: 'from' })]);
  flushSync();
  expect(told.map((event) => event.type)).toEqual(['tail', 'entry', 'entry', 'tail', 'entry', 'removed']);
  expect(told[0]).toMatchObject({ tail: { restart: false, id: 'a1', text: 'llo' } });
  expect(told[2]).toMatchObject({ entry: { id: 't1', tool: { state: 'running' } } });
  expect(told[4]).toMatchObject({ entry: { id: 't1', tool: { state: 'done', output: 'a b' } } });
  expect(told[5]).toMatchObject({ ids: ['m3', 'a1', 't1'] });

  expect(await host.methods['tagma/transcript/older']!({ threadId: 't1' }, call())).toMatchObject({
    threadId: 't1',
    entries: [{ id: 'm0' }],
    more: false,
  });
});

test('over the view bridge the answer is posted first and the reply streams after it as notifications', async () => {
  const fold = new ChatFold();
  fold.apply([reset([message('m1', 'user', 'go')], [message('a1', 'assistant', 'He')])]);
  const seat = new Seat(fold);
  const host = pluginHost({ transcripts: { take: () => seat }, methods: [] } as unknown as Parameters<typeof pluginHost>[0], {
    projectId: 1,
    plugin: 'poker',
    view: 'table',
    threadId: null,
    key: null,
  });
  const posted: {
    readonly id?: number;
    readonly method?: string;
    readonly result?: { readonly type: string };
    readonly params?: ViewParams;
  }[] = [];
  const frame = {};
  const bridge = new ViewBridge(
    { origin: 'http://poker.localhost', source: () => frame, post: (message) => posted.push(message as never) },
    host,
    {
      src: 'http://poker.localhost/ui/table.html',
      csp: {},
      permissions: {},
    },
  );
  const send = (data: object) => bridge.receive({ source: frame, origin: 'http://poker.localhost', data: { jsonrpc: '2.0', ...data } });

  send({ method: 'ui/notifications/initialized' });
  send({ id: 1, method: 'tagma/transcript', params: { threadId: 't1' } });
  flushSync();
  await vi.advanceTimersByTimeAsync(0);
  fold.apply([grow('a1', 'llo')]);
  flushSync();

  expect(posted.map((message) => message.id ?? message.method)).toEqual([1, TRANSCRIPT_CHANGED]);
  expect(posted[0]!.result).toMatchObject({ type: 'initial', entries: [{ id: 'm1' }], tail: [{ id: 'a1' }] });
  expect(posted[1]!.params).toMatchObject({ type: 'tail', threadId: 't1', tail: { restart: false, id: 'a1', text: 'llo' } });
});

test('a view that stops watching, or is torn down, gives the session back and hears nothing more', async () => {
  const fold = new ChatFold();
  fold.apply([reset([message('m1', 'user', 'one')])]);
  const seat = new Seat(fold);
  const { host, told, mount, call } = mounted(seat);

  const reading = host.methods['tagma/transcript']!({ threadId: 't1' }, call());
  flushSync();
  await reading;
  await vi.advanceTimersByTimeAsync(0);

  expect(await host.methods['tagma/transcript/unwatch']!({ threadId: 't1' }, call())).toEqual({ watched: true });
  expect(seat.released).toBe(1);
  fold.apply([append(message('m2', 'assistant', 'two'))]);
  flushSync();
  expect(told).toEqual([]);
  expect(await host.methods['tagma/transcript/unwatch']!({ threadId: 't1' }, call())).toEqual({ watched: false });
  await expect(host.methods['tagma/transcript/older']!({ threadId: 't1' }, call())).rejects.toThrow('not watched');

  const again = host.methods['tagma/transcript']!({ threadId: 't1' }, call());
  flushSync();
  await again;
  mount.abort();
  expect(seat.released).toBe(2);
});

test('a thread that cannot be read refuses the view with the reason and holds nothing', async () => {
  const seat = new Seat(new ChatFold());
  seat.status = 'failed';
  seat.problem = 'The thread is gone.';
  const { host, call } = mounted(seat);

  const reading = host.methods['tagma/transcript']!({ threadId: 't1' }, call());
  flushSync();
  await expect(reading).rejects.toThrow('The thread is gone.');
  expect(seat.released).toBe(1);
});
