import { Effect, Fiber, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { it } from '@runlith/effect-test/vitest';
import { describe, expect, test } from 'vitest';
import type { ThreadEventDelta } from '@runlith/agent/transcript/eventFold';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { OPEN_TEXT_MAX, openSlice } from '@runlith/agent/transcript/openText';
import type { ChatEntry } from '../entries';
import { ChatReadRefused } from '../wire/ChatConnection';
import type { TestThread } from '../testing/chatConnection';
import { at, openEvent, settle, snapshotEvent, state, stateEvent, makeChat } from '../testing/chatHarness.svelte';
import { DetachedSessions } from './DetachedSessions';
describe('a thread session reads its feed', () => {
  it.effect('a snapshot lays the journal and the open tail, and an open text grows by what is appended', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', open: [message('assistant:run-1', 'assistant', 'Раз', 'run-1')] }));
      chat.connection.emit(openEvent({ op: 'append', id: 'assistant:run-1', text: ' два' }, at(0, 2)));
      chat.connection.emit(openEvent({ op: 'append', id: 'assistant:run-1', text: ' три' }, at(0, 3)));
      yield* settle;
      expect(assistantText(session.fold.entries)).toBe('Раз два три');
      expect(session.activeRunId).toBe('run-1');
    }),
  );
  it.effect('a skipped sequence re-attaches from the held position instead of folding onto a hole', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({ activeRunId: 'run-1', position: 7, open: [message('assistant:run-1', 'assistant', 'Раз', 'run-1')] }),
      );
      chat.connection.emit(openEvent({ op: 'append', id: 'assistant:run-1', text: ' два' }, at(7, 2)));
      yield* settle;
      chat.connection.emit(openEvent({ op: 'append', id: 'assistant:run-1', text: ' четыре' }, at(7, 4)));
      yield* settle;
      yield* TestClock.adjust(300);
      expect(chat.connection.feeds.map((feed) => feed.from)).toEqual([null, at(7, 2)]);
      expect(chat.connection.open).toBe(1);
      expect(assistantText(session.fold.entries)).toBe('Раз два');
    }),
  );
  it.effect('a resume applies what the journal gained after the held position and replaces the open tail', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const held = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({
          activeRunId: 'run-1',
          position: 3,
          seq: 4,
          transcript: [message('message:user:run-1', 'user', 'привет', 'run-1')],
          open: [message('assistant:run-1', 'assistant', 'Раз', 'run-1')],
        }),
      );
      yield* settle;
      yield* held.detach();
      const { session } = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      expect(chat.connection.feeds.at(-1)?.from).toEqual(at(3, 4));
      chat.connection.emit({
        type: 'resume',
        at: at(5, 9),
        payload: {
          from: at(3, 4),
          records: [
            { position: 3, kind: 'message', entry: message('message:user:run-1', 'user', 'повтор', 'run-1') as never },
            { position: 4, kind: 'message', entry: message('assistant:run-1', 'assistant', 'Раз!', 'run-1') as never },
            { position: 5, kind: 'message', entry: message('assistant:run-1:text:1', 'assistant', 'Два', 'run-1') as never },
          ],
          open: [],
          progress: null,
          snapshot: state({ activeRunId: 'run-1' }),
        },
      });
      yield* settle;
      expect(texts(session.fold.entries)).toEqual(['привет', 'Раз!', 'Два']);
      expect(session.status).toBe('ready');
    }),
  );
  it.effect('a state before any snapshot re-attaches from nothing', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(stateEvent({}, at(4, 1)));
      yield* settle;
      yield* TestClock.adjust(300);
      expect(chat.connection.feeds.map((feed) => feed.from)).toEqual([null, null]);
      expect(session.fold.entries).toHaveLength(0);
    }),
  );
  it.effect('the phase and the context estimate of a running call arrive on the open stream', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
      yield* settle;
      expect(session.runPhase).toBeNull();
      chat.connection.emit(
        openEvent(
          {
            op: 'progress',
            progress: {
              phase: { phase: 'tools', calls: [], since: Date.parse('2026-01-01T00:05:00.000Z') } as never,
              estimate: { stepNumber: 2, tokens: 9000, contextWindow: 200000 },
            },
          },
          at(0, 2),
        ),
      );
      yield* settle;
      expect(session.runPhase).toMatchObject({ phase: 'tools' });
      expect(session.liveContext).toMatchObject({ runId: 'run-1', estimate: { tokens: 9000 } });
      chat.connection.emit(openEvent({ op: 'progress', progress: { phase: null, estimate: null } }, at(0, 3)));
      yield* settle;
      expect(session.runPhase).toBeNull();
      expect(session.liveContext).toBeNull();
    }),
  );
});
describe('the page above a session', () => {
  it.effect('opening a thread asks for no page, and each ask prepends one page and keeps the cursor it carries', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const pages = [
        { entries: [message('a-2', 'assistant', 'a-2')], before: 4 },
        { entries: [message('u-1', 'user', 'u-1'), message('a-1', 'assistant', 'a-1')], before: null },
      ];
      chat.connection.stub('entriesBefore', () => Effect.succeed(pages.shift() ?? { entries: [], before: null }));
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6, transcript: [message('a-3', 'assistant', 'a-3')] }));
      yield* settle;
      expect(chat.connection.called('entriesBefore')).toHaveLength(0);
      expect(session.hasOlder).toBe(true);
      expect(yield* session.loadOlder()).toBe(true);
      expect(ids(session.fold.entries)).toEqual(['a-2', 'a-3']);
      expect(yield* session.loadOlder()).toBe(true);
      expect(ids(session.fold.entries)).toEqual(['u-1', 'a-1', 'a-2', 'a-3']);
      expect(session.hasOlder).toBe(false);
      expect(yield* session.loadOlder()).toBe(false);
      expect(chat.connection.called('entriesBefore').map((call) => call.input)).toEqual([{ before: 6 }, { before: 4 }]);
    }),
  );
  it.effect('a refused page is its own answer, leaves the transcript untouched and does not wedge the next ask', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      let refuse = true;
      chat.connection.stub('entriesBefore', () =>
        refuse
          ? Effect.fail(new ChatReadRefused({ message: 'the channel refused' }))
          : Effect.succeed({ entries: [message('u-0', 'user', 'u-0')], before: null }),
      );
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6, transcript: [message('a-1', 'assistant', 'a-1')] }));
      yield* settle;
      const refused = yield* Effect.flip(session.loadOlder());
      expect(refused).toBeInstanceOf(ChatReadRefused);
      expect(ids(session.fold.entries)).toEqual(['a-1']);
      refuse = false;
      expect(yield* session.loadOlder()).toBe(true);
      expect(ids(session.fold.entries)).toEqual(['u-0', 'a-1']);
    }),
  );
  it.effect('two asks in flight cost one call, and a record landing meanwhile is kept beside the page', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      chat.connection.stub('entriesBefore', () => Effect.succeed({ entries: [message('u-0', 'user', 'u-0')], before: null }));
      const asked = chat.connection.hold('entriesBefore');
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6, transcript: [message('u-1', 'user', 'u-1')] }));
      yield* settle;
      const asks = [
        yield* Effect.forkChild(session.loadOlder(), { startImmediately: true }),
        yield* Effect.forkChild(session.loadOlder(), { startImmediately: true }),
      ];
      yield* Effect.promise(() => asked);
      chat.connection.emit(stateEvent({}, at(10, 2), [record(10, message('a-2', 'assistant', 'a-2'))]));
      yield* settle;
      expect(ids(session.fold.entries)).toEqual(['u-1', 'a-2']);
      chat.connection.release('entriesBefore');
      expect(yield* Fiber.joinAll(asks)).toEqual([true, true]);
      expect(chat.connection.called('entriesBefore')).toHaveLength(1);
      expect(ids(session.fold.entries)).toEqual(['u-0', 'u-1', 'a-2']);
    }),
  );
  it.effect('a fresh snapshot replaces a walked-back transcript with the page it carries', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      chat.connection.stub('entriesBefore', () => Effect.succeed({ entries: [message('u-0', 'user', 'u-0')], before: null }));
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 9, before: 6, transcript: [message('u-1', 'user', 'u-1')] }));
      yield* settle;
      yield* session.loadOlder();
      chat.connection.emit(snapshotEvent({ position: 20, seq: 5, before: 12, transcript: [message('u-5', 'user', 'u-5')] }));
      yield* settle;
      expect(ids(session.fold.entries)).toEqual(['u-5']);
      expect(session.hasOlder).toBe(true);
    }),
  );
});
describe('a row whose bodies the page withheld', () => {
  it.effect('the whole entry replaces the bounded one in place, and one the server cannot answer leaves the row standing', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      let whole: ThreadTranscriptEntry | null = null;
      chat.connection.stub('entry', () => Effect.succeed(whole));
      const { session } = yield* chat.open();
      chat.connection.emit(
        snapshotEvent({
          transcript: [
            message('u-1', 'user', 'read it'),
            {
              type: 'tool',
              id: 'call-1',
              runId: 'run-1',
              toolName: 'read',
              toolCallId: 'call-1',
              toolState: 'output-available',
              truncated: 4096,
            },
          ],
        }),
      );
      yield* settle;
      yield* session.loadEntry('call-1');
      expect(session.fold.entries.at(-1)).toMatchObject({ truncated: 4096 });
      whole = {
        type: 'tool',
        id: 'call-1',
        runId: 'run-1',
        toolName: 'read',
        toolCallId: 'call-1',
        toolState: 'output-available',
        toolOutput: 'every byte of it',
      } as ThreadTranscriptEntry;
      yield* session.loadEntry('call-1');
      expect(ids(session.fold.entries)).toEqual(['u-1', 'call-1']);
      expect(session.fold.entries.at(-1)).toMatchObject({ kind: 'tool', truncated: undefined, toolOutput: 'every byte of it' });
    }),
  );
});
describe('an open answer that arrives as its newest window', () => {
  it.effect('is completed by reading the prefix it lacks page by page, never splitting a pair, and keeps growing', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const split = 10;
      const prefix = `${'x'.repeat(split - 1)}😀${'y'.repeat(OPEN_TEXT_MAX - 1)}`;
      const whole = `${prefix}window more`;
      chat.connection.stub('text', ({ entryId, from, limit }) =>
        Effect.succeed(entryId === 'assistant:run-1' ? openSlice(whole, from, limit) : null),
      );
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
      chat.connection.emit(
        openEvent({ op: 'put', entry: message('assistant:run-1', 'assistant', 'window', 'run-1'), from: prefix.length }, at(0, 2)),
      );
      chat.connection.emit(openEvent({ op: 'append', id: 'assistant:run-1', text: ' more' }, at(0, 3)));
      yield* settle;
      expect(assistantText(session.fold.entries)).toBe(whole);
      const asked = chat.connection.calls.filter((call) => call.command === 'text').map((call) => call.input);
      expect(asked).toEqual([
        { entryId: 'assistant:run-1', from: prefix.length - OPEN_TEXT_MAX, limit: OPEN_TEXT_MAX },
        { entryId: 'assistant:run-1', from: 0, limit: split + 1 },
      ]);
    }),
  );
});
describe('an open answer whose window moves while its prefix is read', () => {
  it.effect('reads again from the window that replaced it and drops the page that answered the old one', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const whole = `${'p'.repeat(300)}ending`;
      chat.connection.stub('text', ({ from, limit }) => Effect.succeed(openSlice(whole, from, limit)));
      const reached = chat.connection.hold('text');
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1' }));
      chat.connection.emit(
        openEvent({ op: 'put', entry: message('assistant:run-1', 'assistant', whole.slice(100, 110), 'run-1'), from: 100 }, at(0, 2)),
      );
      yield* settle;
      yield* Effect.promise(() => reached);
      chat.connection.emit(
        openEvent({ op: 'put', entry: message('assistant:run-1', 'assistant', 'ending', 'run-1'), from: 300 }, at(0, 3)),
      );
      yield* settle;
      chat.connection.release('text');
      yield* settle;
      expect(assistantText(session.fold.entries)).toBe(whole);
    }),
  );
});
describe('words another agent left for a run that has not read them yet', () => {
  it.effect('wait beside the operator’s steers with their sender, kept off the feed until the record that carries them lands', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      const arrived = [{ id: 'envelope-1', occurredAt: '2026-01-01T00:00:05.000Z' }];
      const steers = [{ id: 'steer-1', text: 'use the other table' }];
      chat.connection.emit(
        snapshotEvent({ activeRunId: 'run-1', transcript: [timedTool('before', '2026-01-01T00:00:01.000Z')], steers, arrived }),
      );
      yield* settle;
      expect(ids(session.fold.entries)).toEqual(['tool:before']);
      expect(session.pendingSteers).toMatchObject([
        { id: 'steer-1', sender: null, removable: true },
        { id: 'transcript:signal:envelope-1', sender: { name: 'reviewer' }, intent: 'message', removable: false },
      ]);
      chat.connection.emit(stateEvent({ activeRunId: 'run-1' }, at(1, 2), [record(1, readEnvelope('2026-01-01T00:00:09.000Z'))]));
      yield* settle;
      expect(session.pendingSteers).toEqual([]);
      expect(session.fold.entries.at(-1)).toMatchObject({ kind: 'words', intent: 'message', sender: { name: 'reviewer' } });
    }),
  );
});
describe('the modes a thread declares', () => {
  const declared = [
    { id: 'trust', label: 'Trust', description: 'Acts without asking.' },
    { id: 'review', label: 'Review', description: 'Asks before it writes.' },
    { id: 'plan', label: 'Plan', description: 'Writes nothing.' },
  ];
  it.effect('arrive with the feed as data, and the active mode another client switched arrives with the next frame', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      expect(session.modes).toBeNull();
      chat.connection.emit(snapshotEvent({ position: 1, modes: { declared, active: 'trust' } }));
      yield* settle;
      expect(session.modes).toEqual({ declared, active: 'trust' });
      chat.connection.emit(stateEvent({ modes: { declared, active: 'plan' } }, at(1, 2)));
      yield* settle;
      expect(session.modes).toEqual({ declared, active: 'plan' });
    }),
  );
});
describe('the context a session reads', () => {
  const reading = {
    usage: { inputTokens: 168600 },
    contextWindow: 1000000,
    runId: 'run-1',
    stepNumber: 3,
    provider: 'subscription',
    model: 'claude-opus-5',
    measuredAt: '2026-01-01T00:00:00.000Z',
    stale: false,
  } as never;
  it.effect('is the measured reading, with the estimate of the next call beside it while the run lasts', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 1, activeRunId: 'run-2', contextReading: reading }));
      yield* settle;
      expect(session.contextSource).toMatchObject({ reading: 'measured', contextTokens: 168600, nextRequest: null });
      chat.connection.emit(
        openEvent(
          { op: 'progress', progress: { phase: null, estimate: { stepNumber: 0, tokens: 172000, contextWindow: 1000000 } } },
          at(1, 2),
        ),
      );
      yield* settle;
      expect(session.contextSource).toMatchObject({ contextTokens: 168600, nextRequest: { tokens: 172000 } });
      chat.connection.emit(stateEvent({ contextReading: reading }, at(1, 3)));
      yield* settle;
      expect(session.contextSource).toMatchObject({ reading: 'measured', nextRequest: null });
    }),
  );
  it.effect('carries the limit the newest state names, so a moved compaction point reaches the figure without a request', () =>
    Effect.gen(function* () {
      const at550 = { window: 1000000, compaction: { at: 550000, strategy: 'percent', share: 0.55, source: 'override' } } as const;
      const at800 = { window: 1000000, compaction: { at: 800000, strategy: 'percent', share: 0.8, source: 'global' } } as const;
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 1, contextReading: reading, contextLimit: at550 }));
      yield* settle;
      expect(session.contextSource.limit).toEqual(at550);
      chat.connection.emit(stateEvent({ contextReading: reading, contextLimit: at800 }, at(1, 2)));
      yield* settle;
      expect(session.contextSource.limit).toEqual(at800);
    }),
  );
});
describe('a thread that exists', () => {
  it.effect('is opening while its first frame is still on the way', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      expect(session.threadPhase).toEqual({ kind: 'opening', threadId: 'thread-1' });
    }),
  );
  it.effect('states the server refusal that stopped it from being read', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.refuse('block 5940aab8 is in the trash');
      yield* settle;
      expect(session.threadPhase).toEqual({ kind: 'unreadable', threadId: 'thread-1', errors: ['block 5940aab8 is in the trash'] });
    }),
  );
  it.effect('keeps what it showed when the socket dies under it, names each reason once, and is readable again at the next snapshot', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: conversation() }));
      yield* settle;
      chat.connection.emit({ type: 'interrupted', message: 'The live connection closed.' });
      chat.connection.emit({ type: 'interrupted', message: 'The live connection closed.' });
      chat.connection.emit({ type: 'interrupted', message: 'The server stopped answering.' });
      yield* settle;
      expect(session.fold.entries.map((entry) => entry.kind)).toEqual(['user', 'assistant']);
      expect(session.errors).toEqual(['The live connection closed.', 'The server stopped answering.']);
      expect(session.life).toBeNull();
      expect(session.verdict).toMatchObject({ phase: 'reconnecting', reason: 'The server stopped answering.' });
      expect(chat.connection.feeds).toHaveLength(1);
      chat.connection.emit(snapshotEvent({ transcript: conversation(), seq: 2 }));
      yield* settle;
      expect(session.threadPhase).toEqual({ kind: 'open', threadId: 'thread-1' });
      expect(session.errors).toEqual([]);
    }),
  );
  it.effect(
    'reads a feed that broke under it again from where it stood, names the defect instead of a lost connection, and is live at the next frame',
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse('2026-10-20T22:32:00.000Z'));
        const chat = yield* makeChat();
        const { session } = yield* chat.open();
        chat.connection.emit(snapshotEvent({ position: 4, seq: 2, activeRunId: 'run-1', transcript: conversation() }));
        yield* settle;
        yield* TestClock.adjust('2 seconds');
        chat.connection.break('Expected JSON value at ["entry"]["toolOutput"]');
        yield* settle;
        expect(session.errors).toEqual(['Expected JSON value at ["entry"]["toolOutput"]']);
        expect(session.verdict).toMatchObject({
          phase: 'unreadable',
          reason: 'Expected JSON value at ["entry"]["toolOutput"]',
          asOf: Date.parse('2026-10-20T22:32:00.000Z'),
          pulse: false,
        });
        yield* TestClock.adjust(400);
        expect(chat.connection.feeds.map((feed) => feed.from)).toEqual([null, { position: 4, seq: 2 }]);
        chat.connection.emit(snapshotEvent({ position: 5, seq: 1, activeRunId: 'run-1', transcript: conversation() }));
        yield* settle;
        expect(session.threadPhase).toEqual({ kind: 'open', threadId: 'thread-1' });
        expect(session.verdict).toMatchObject({ runId: 'run-1', phase: 'working', reason: null, asOf: null, pulse: true });
      }),
  );
  it.effect('a refused feed is not read again, and claims no live run', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', transcript: conversation() }));
      yield* settle;
      chat.connection.refuse('thread-gone');
      yield* settle;
      expect(session.threadPhase.kind).toBe('unreadable');
      expect(session.verdict).toBeNull();
      expect(chat.connection.feeds).toHaveLength(1);
    }),
  );
  it.effect('opened by its address with no first frame coming, it shows the opening failure instead of waiting forever', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open('thread-1', { openingDeadlineMs: 5 });
      yield* TestClock.adjust(20);
      expect(session.threadPhase.kind).toBe('unreadable');
    }),
  );
});
describe('the life of a session', () => {
  it.effect('a session let go before its first frame answers whoever waits on its opening', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const held = yield* chat.open();
      const opened = yield* Effect.forkChild(held.session.opened(), { startImmediately: true });
      yield* held.detach();
      expect(yield* Fiber.join(opened)).toBe(false);
    }),
  );
  it.effect('detached and attached again, it resumes from its cursor with the store it held', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const first = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 12, seq: 3, transcript: conversation() }));
      yield* settle;
      yield* first.detach();
      expect(chat.connection.open).toBe(0);
      const { session } = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      expect(chat.connection.feeds.at(-1)?.from).toEqual(at(12, 3));
      expect(session.status).toBe('ready');
      expect(session.fold.entries.map((entry) => entry.kind)).toEqual(['user', 'assistant']);
    }),
  );
  it.effect('the run keeps its age on the server clock across the time it spent detached', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-01-01T09:00:00.000Z'));
      const chat = yield* makeChat();
      const first = yield* chat.open();
      chat.connection.emit(snapshotEvent({ activeRunId: 'run-1', position: 12 }));
      yield* settle;
      const startedAt = first.session.runStartedAt;
      yield* first.detach();
      yield* TestClock.adjust('13 minutes');
      const { session } = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      expect(session.runStartedAt).toBe(startedAt);
    }),
  );
  it.effect('a resume the server refuses arrives as a snapshot and is taken like any other', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const first = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 12, transcript: conversation() }));
      yield* settle;
      yield* first.detach();
      const { session } = yield* chat.open('thread-1', { detached: chat.detached.take('thread-1') });
      chat.connection.emit(snapshotEvent({ position: 40, seq: 30, transcript: [message('u-9', 'user', 'u-9')] }));
      yield* settle;
      expect(ids(session.fold.entries)).toEqual(['u-9']);
    }),
  );
  it.effect('a state evicted from the shelf comes back as a snapshot', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const shelf = new DetachedSessions<TestThread>({ sessions: 1 });
      for (const threadId of ['thread-1', 'thread-2']) {
        const held = yield* chat.open(threadId);
        chat.connection.emit(snapshotEvent({ position: 3 }), threadId);
        yield* settle;
        const detached = yield* held.session.detach();
        if (detached) shelf.put(threadId, detached);
        yield* held.dispose();
      }
      expect(shelf.take('thread-1')).toBeUndefined();
      yield* chat.open('thread-1');
      expect(chat.connection.feeds.at(-1)?.from).toBeNull();
    }),
  );
  it.effect('after dispose there is no subscription and no opening timer', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const held = yield* chat.open('thread-1', { openingDeadlineMs: 5 });
      yield* held.dispose();
      yield* TestClock.adjust(20);
      expect(chat.connection.open).toBe(0);
      expect(held.session.status).toBe('loading');
    }),
  );
  it.effect('frames that reach an abandoned subscription change nothing', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const { session } = yield* chat.open();
      chat.connection.emit(snapshotEvent({ position: 5, transcript: [message('u-1', 'user', 'u-1')] }));
      chat.connection.emit(stateEvent({}, at(5, 3)));
      yield* settle;
      const abandoned = chat.connection.feeds[0]!;
      Queue.offerUnsafe(abandoned.queue, snapshotEvent({ position: 30, transcript: [message('stale', 'user', 'stale')] }));
      yield* settle;
      expect(abandoned.open).toBe(false);
      expect(ids(session.fold.entries)).toEqual(['u-1']);
    }),
  );
});
describe('the shelf of detached sessions', () => {
  it.effect('holds at most its count, and a session heavier than a quarter of its weight is never held', () =>
    Effect.gen(function* () {
      const chat = yield* makeChat();
      const shelf = new DetachedSessions<TestThread>({ sessions: 2, bytes: 4000 });
      const detach = Effect.fnUntraced(function* (threadId: string, text: string) {
        const held = yield* chat.open(threadId);
        chat.connection.emit(snapshotEvent({ position: 1, transcript: [message(`u-${threadId}`, 'user', text)] }), threadId);
        yield* settle;
        const detached = yield* held.session.detach();
        yield* held.dispose();
        if (detached) shelf.put(threadId, detached);
      });
      yield* detach('a', 'короткий');
      yield* detach('b', 'короткий');
      yield* detach('c', 'короткий');
      yield* detach('heavy', 'x'.repeat(2000));
      expect(['a', 'b', 'c', 'heavy'].map((threadId) => shelf.take(threadId) !== undefined)).toEqual([false, true, true, false]);
    }),
  );
});
function record(position: number, entry: ThreadTranscriptEntry): ThreadEventDelta {
  return { position, kind: entry.type, entry };
}
function message(id: string, role: 'user' | 'assistant', text: string, runId?: string): ThreadTranscriptEntry {
  return { type: 'message', id, role, text, runId } as ThreadTranscriptEntry;
}
function timedTool(callId: string, occurredAt: string): ThreadTranscriptEntry {
  return {
    type: 'tool',
    id: `tool:${callId}`,
    runId: 'run-1',
    toolName: 'bash',
    toolState: 'output-available',
    occurredAt,
  } as unknown as ThreadTranscriptEntry;
}
function readEnvelope(occurredAt: string): ThreadTranscriptEntry {
  return {
    type: 'signal',
    id: 'transcript:signal:envelope-1',
    runId: 'run-1',
    signalType: 'message',
    addressee: 'transport',
    title: 'reviewer',
    text: 'look at this before you commit',
    occurredAt,
  };
}
function conversation(): ThreadTranscriptEntry[] {
  return [message('message:user:run-1', 'user', 'привет', 'run-1'), message('assistant:run-1', 'assistant', 'на связи', 'run-1')];
}
function ids(entries: readonly ChatEntry[]): string[] {
  return entries.map((entry) => entry.id);
}
function texts(entries: readonly ChatEntry[]): string[] {
  return entries.flatMap((entry) => ('text' in entry && typeof entry.text === 'string' ? [entry.text] : []));
}
function assistantText(entries: readonly ChatEntry[]): string {
  return entries.flatMap((entry) => (entry.kind === 'assistant' ? [entry.text] : [])).join('');
}
