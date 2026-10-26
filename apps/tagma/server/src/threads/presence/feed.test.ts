import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { RunStatus } from '@runlith/agent/transcript/live';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { HarnessFailure } from '../contract/service/failure.js';
import { EvidenceFeed, ThreadEvidence, type PresenceSource } from '../contract/service/evidence.js';
import { ThreadList } from '../contract/service/list.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { PresenceEvent, PresenceTail } from '../contract/wire/presence.js';
import { applyTail } from '../contract/wire/tail.js';
import { TAIL_CODE_POINTS } from './tail.js';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadSummary } from '../list/summary.js';
import { presenceFeed } from './feed.js';
import { makePresenceWatches } from './watches.js';

function unused(): never {
  throw new Error('This operation is outside the presence feed.');
}

const idle = (threadId: string): RunStatus => ({
  threadId,
  runId: null,
  life: 'idle',
  stage: null,
  openQuestions: [],
  since: null,
  receipts: [],
});

const working = (threadId: string): RunStatus => ({
  threadId,
  runId: 'run',
  life: 'working',
  stage: null,
  openQuestions: [],
  since: '2026-10-08T00:00:00.000Z',
  ownership: 'held',
  receipts: [],
});

const summaryOf = (id: string, over: Partial<ThreadSummary> = {}): ThreadSummary =>
  ({
    id,
    activeRun: null,
    ask: null,
    saidLine: null,
    outcome: null,
    provider: 'provider',
    model: 'model',
    reasoning: null,
    archivedAt: null,
    ...over,
  }) as unknown as ThreadSummary;

const found = (id: string, status: RunStatus = idle(id), over: Partial<ThreadSummary> = {}): PresenceSource => ({
  threadId: id,
  outcome: 'found',
  summary: summaryOf(id, over),
  status,
});

const thought = (runId: string, id: string, text: string): ThreadTranscriptEntry =>
  ({ type: 'reasoning', id, runId, text, state: 'streaming', occurredAt: '2026-10-08T00:00:00.000Z' }) as unknown as ThreadTranscriptEntry;

const world = Effect.fnUntraced(function* () {
  const live = yield* makeThreadLiveFeed<NativeThreadState>();
  const known = new Map<string, PresenceSource>();
  const reads: string[][] = [];
  const observers = new Map<string, Set<() => void>>();
  let beforeAnswer: (() => void) | undefined;
  let afterAnswer: (() => void) | undefined;
  let failing: HarnessFailure | undefined;
  const read = Effect.fnUntraced(function* (ids: readonly string[]) {
    yield* Effect.yieldNow;
    reads.push([...ids]);
    if (failing !== undefined) return yield* Effect.fail(failing);
    const before = beforeAnswer;
    beforeAnswer = undefined;
    before?.();
    const answer = ids.map((id) => known.get(id) ?? ({ threadId: id, outcome: 'not-found' } as const));
    const after = afterAnswer;
    afterAnswer = undefined;
    after?.();
    if (after !== undefined) yield* Effect.sleep(5);
    return answer;
  });
  const evidence: ThreadEvidence['Service'] = {
    snapshot: unused,
    statuses: unused,
    endings: unused,
    shape: unused,
    composition: unused,
    held: unused,
    entry: unused,
    entries: unused,
    attachFrom: unused,
    rewindActs: unused,
    presence: (ids) => read(ids),
    presenceOne: (id) => Effect.map(read([id]), (answer) => answer[0]!),
  };
  const list: ThreadList['Service'] = {
    attention: unused,
    pulse: unused,
    subscribeAttention: unused,
    observe: (threadId, notify) => {
      const held = observers.get(threadId) ?? new Set();
      held.add(notify);
      observers.set(threadId, held);
      return () => held.delete(notify);
    },
    list: unused,
    listWindow: unused,
    openWindow: unused,
    row: unused,
    subscribe: unused,
    announce: unused,
    announceThread: unused,
    announceFolders: unused,
    resync: unused,
    markHeld: unused,
    relation: unused,
    working: unused,
    sweepRelation: unused,
    serveArchiving: unused,
    serveOpenCalls: unused,
    setArchived: unused,
    setArchivedMatching: unused,
    setPinned: unused,
    see: unused,
  };
  const watches = yield* makePresenceWatches.pipe(
    Effect.provideService(ThreadEvidence, evidence),
    Effect.provideService(ThreadList, list),
    Effect.provideService(EvidenceFeed, {
      subscribe: (threadId, listener) => live.subscribe(threadId, listener),
      view: (threadId) => live.view(threadId),
    }),
  );
  return {
    known,
    reads,
    live,
    feed: presenceFeed(watches),
    moved(threadId: string) {
      live.publishState({ state: { thread: { id: threadId }, activeRun: null } as unknown as NativeThreadState, from: 0, deltas: [] });
    },
    think(threadId: string, runId: string, id: string, text: string) {
      live.tail(threadId, runId, [thought(runId, id, text)], []);
    },
    more(threadId: string, runId: string, id: string, text: string) {
      live.append(threadId, runId, id, text);
    },
    finish(threadId: string, runId: string, id: string, text: string) {
      live.tail(threadId, runId, [{ ...thought(runId, id, text), state: 'done' } as unknown as ThreadTranscriptEntry], []);
    },
    dropped(threadId: string, runId: string) {
      live.tail(threadId, runId, [], []);
    },
    landing(threadId: string, runId: string, id: string) {
      live.tail(threadId, runId, [], [id]);
      live.publishState({
        state: { thread: { id: threadId }, activeRun: { id: runId } } as unknown as NativeThreadState,
        from: 0,
        deltas: [{ position: 1, entry: { id } }],
      } as unknown as Parameters<typeof live.publishState>[0]);
    },
    withdrawn(threadId: string, runId: string) {
      this.ended(threadId, runId, true);
    },
    ended(threadId: string, runId: string, withdrawn = false) {
      live.publishState({
        state: {
          thread: { id: threadId },
          activeRun: withdrawn ? { id: runId } : null,
          latestRun: { id: runId },
          position: 1,
        } as unknown as NativeThreadState,
        from: 0,
        deltas: withdrawn ? [{ position: 1, kind: 'withdraw', withdrawn: { runId } }] : [],
      });
    },
    before(work: () => void) {
      beforeAnswer = work;
    },
    failWith(failure: HarnessFailure | undefined) {
      failing = failure;
    },
    after(work: () => void) {
      afterAnswer = work;
    },
  };
});

function initial(event: PresenceEvent | undefined) {
  if (event?.type !== 'initial') throw new Error(`Expected the initial answer, received ${event?.type}`);
  return event.entries;
}

it.live('the initial answer has an entry for every id: rows, archived threads, and missing ones with their reason', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a', working('a'), { saidLine: 'hello' }));
    rig.known.set('shelved', found('shelved', idle('shelved'), { archivedAt: new Date(1_000) }));
    rig.known.set('elsewhere', { threadId: 'elsewhere', outcome: 'foreign-project' });
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a', 'elsewhere', 'nowhere', 'shelved'] }));
    const entries = initial((yield* next)[0]);
    expect(
      entries.map((entry) =>
        entry.type === 'row' ? [entry.type, entry.row.threadId, entry.revision] : [entry.type, entry.threadId, entry.reason],
      ),
    ).toEqual([
      ['row', 'a', 1],
      ['missing', 'elsewhere', 'foreign-project'],
      ['missing', 'nowhere', 'not-found'],
      ['row', 'shelved', 1],
    ]);
    const [a, , , shelved] = entries;
    expect(a?.type === 'row' && a.row).toMatchObject({ status: { life: 'working' }, saidLine: 'hello', archived: false });
    expect(shelved?.type === 'row' && shelved.row.archived).toBe(true);
  }),
);

it.live('a change that lands while the initial rows are read is delivered once, with only the fields that moved', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    rig.after(() => {
      rig.known.set('a', found('a', idle('a'), { saidLine: 'said' }));
      rig.moved('a');
    });
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    const [row] = initial((yield* next)[0]);
    expect(row?.type === 'row' && row.row.saidLine).toBe(null);
    expect((yield* next)[0]).toEqual({ type: 'changed', threadId: 'a', revision: 2, fields: { saidLine: 'said' } });
    rig.moved('a');
    rig.known.set('a', found('a', working('a'), { saidLine: 'said' }));
    rig.moved('a');
    expect((yield* next)[0]).toEqual({ type: 'changed', threadId: 'a', revision: 3, fields: { status: working('a') } });
  }),
);

it.live('a change already inside the initial read is not delivered again', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    rig.before(() => {
      rig.known.set('a', found('a', idle('a'), { saidLine: 'said' }));
      rig.moved('a');
    });
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    const [row] = initial((yield* next)[0]);
    expect(row?.type === 'row' && [row.revision, row.row.saidLine]).toEqual([1, 'said']);
    rig.known.set('a', found('a', working('a'), { saidLine: 'said' }));
    rig.moved('a');
    expect((yield* next)[0]).toMatchObject({ type: 'changed', revision: 2 });
  }),
);

it.live('a deleted thread is announced as missing', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    initial((yield* next)[0]);
    rig.known.delete('a');
    rig.moved('a');
    expect((yield* next)[0]).toEqual({ type: 'missing', threadId: 'a', reason: 'deleted' });
  }),
);

it.live('a reconnect asks again and receives the current rows; a thread no stream follows any more is no longer read', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    rig.known.set('b', found('b'));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const both = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a', 'b'] }));
        initial((yield* both)[0]);
        rig.known.set('a', found('a', working('a')));
        rig.moved('a');
        expect((yield* both)[0]).toMatchObject({ type: 'changed', threadId: 'a', revision: 2 });
        const only = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
        const [again] = initial((yield* only)[0]);
        expect(again?.type === 'row' && [again.revision, again.row.status.life]).toEqual([2, 'working']);
      }),
    );
    const before = rig.reads.length;
    rig.moved('a');
    yield* Effect.sleep(5);
    expect(rig.reads.length).toBe(before);
  }),
);

it.live('a thread nobody watches costs no presence work, however often it moves', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    initial((yield* next)[0]);
    const baseline = rig.reads.length;
    for (let index = 0; index < 200; index += 1) rig.moved('quiet');
    yield* Effect.sleep(5);
    expect(rig.reads.length).toBe(baseline);
  }),
);

it.live('a read that fails fails the subscription that made it instead of answering the thread as missing', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a'));
    rig.failWith(new ThreadCallBroke({ cause: new Error('the register did not answer') }));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    const exit = yield* Effect.exit(next);
    expect(exit._tag).toBe('Failure');
  }),
);

it.live(
  'a deletion that lands while another set reads is answered as deleted to the new set and announced once to the one that follows the thread',
  () =>
    Effect.gen(function* () {
      const rig = yield* world();
      rig.known.set('a', found('a'));
      rig.known.set('b', found('b'));
      const first = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
      initial((yield* first)[0]);
      rig.after(() => {
        rig.known.delete('a');
        rig.moved('a');
      });
      const second = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a', 'b'] }));
      const entries = initial((yield* second)[0]);
      expect(entries.map((entry) => [entry.type, entry.type === 'missing' ? entry.reason : entry.row.threadId])).toEqual([
        ['missing', 'deleted'],
        ['row', 'b'],
      ]);
      expect((yield* first)[0]).toEqual({ type: 'missing', threadId: 'a', reason: 'deleted' });
      rig.known.set('b', found('b', working('b')));
      rig.moved('b');
      expect((yield* second)[0]).toMatchObject({ type: 'changed', threadId: 'b', revision: 2 });
    }),
);

const tailOf = (event: PresenceEvent | undefined) => {
  if (event?.type !== 'tail') throw new Error(`Expected a tail event, received ${event?.type}`);
  return event.tail;
};

const rowTail = (event: PresenceEvent | undefined) => {
  const [entry] = initial(event);
  return entry?.type === 'row' ? entry.row.tail : undefined;
};

it.live('the tail starts on a reasoning entry, extends it, restarts on the next entry and ends when the open entry leaves', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a', working('a')));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    initial((yield* next)[0]);
    rig.think('a', 'run-1', 'r1', 'first');
    expect(tailOf((yield* next)[0])).toEqual({ restart: true, runId: 'run-1', entryId: 'r1', text: 'first' });
    rig.more('a', 'run-1', 'r1', ' more');
    expect(tailOf((yield* next)[0])).toEqual({ restart: false, text: ' more', drop: 0 });
    rig.think('a', 'run-1', 'r2', 'second');
    expect(tailOf((yield* next)[0])).toEqual({ restart: true, runId: 'run-1', entryId: 'r2', text: 'second' });
    rig.finish('a', 'run-1', 'r2', 'second');
    rig.moved('a');
    rig.think('a', 'run-1', 'r3', 'third');
    expect(tailOf((yield* next)[0])).toEqual({ restart: true, runId: 'run-1', entryId: 'r3', text: 'third' });
    rig.dropped('a', 'run-1');
    expect(tailOf((yield* next)[0])).toBe(null);
  }),
);

it.live('a reasoning entry that settles with the same text keeps the tail, and landing, settlement and withdraw end it', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a', working('a')));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    initial((yield* next)[0]);
    rig.think('a', 'run-1', 'r1', 'thought');
    tailOf((yield* next)[0]);
    rig.finish('a', 'run-1', 'r1', 'thought');
    rig.think('a', 'run-1', 'r2', 'next');
    expect(tailOf((yield* next)[0])).toMatchObject({ restart: true, entryId: 'r2' });
    rig.landing('a', 'run-1', 'r2');
    expect(tailOf((yield* next)[0])).toBe(null);
    rig.think('a', 'run-2', 'r3', 'third');
    expect(tailOf((yield* next)[0])).toMatchObject({ restart: true, runId: 'run-2', entryId: 'r3' });
    rig.ended('a', 'run-2');
    expect(tailOf((yield* next)[0])).toBe(null);
    rig.think('a', 'run-3', 'r4', 'fourth');
    tailOf((yield* next)[0]);
    rig.withdrawn('a', 'run-3');
    expect(tailOf((yield* next)[0])).toBe(null);
  }),
);

it.live(
  'a subscription opened later starts from the producer tail of an entry already open, and an append over the limit restarts the tail',
  () =>
    Effect.gen(function* () {
      const rig = yield* world();
      rig.known.set('a', found('a', working('a')));
      const long = `${'a'.repeat(TAIL_CODE_POINTS - 2)}😀z`;
      rig.think('a', 'run-1', 'r1', `${'old '.repeat(100)}${long}`);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
          expect(rowTail((yield* first)[0])).toEqual({ runId: 'run-1', entryId: 'r1', text: long });
        }),
      );
      const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
      expect(rowTail((yield* next)[0])).toEqual({ runId: 'run-1', entryId: 'r1', text: long });
      const over = `${'b'.repeat(TAIL_CODE_POINTS)}é`;
      rig.more('a', 'run-1', 'r1', over);
      expect(tailOf((yield* next)[0])).toEqual({
        restart: true,
        runId: 'run-1',
        entryId: 'r1',
        text: [...over].slice(-TAIL_CODE_POINTS).join(''),
      });
    }),
);

it.live('a tail increment that lands during the initial read is in the initial row and is not delivered again', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a', working('a')));
    rig.think('a', 'run-1', 'r1', 'before');
    rig.after(() => rig.more('a', 'run-1', 'r1', ' during'));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    const first = (yield* next)[0];
    expect(rowTail(first)?.text).toBe('before during');
    rig.more('a', 'run-1', 'r1', ' after');
    expect(applyTail(rowTail(first), tailOf((yield* next)[0])!)?.text).toBe('before during after');
  }),
);

it.live('a consumer that falls behind receives the latest tail of a thread in one event, in order with its other changes', () =>
  Effect.gen(function* () {
    const rig = yield* world();
    rig.known.set('a', found('a', working('a')));
    const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
    initial((yield* next)[0]);
    rig.think('a', 'run-1', 'r1', 'one');
    rig.more('a', 'run-1', 'r1', ' two');
    rig.more('a', 'run-1', 'r1', ' three');
    expect(tailOf((yield* next)[0])).toEqual({ restart: true, runId: 'run-1', entryId: 'r1', text: 'one two three' });
    rig.more('a', 'run-1', 'r1', ' four');
    rig.known.set('a', found('a', working('a'), { saidLine: 'said' }));
    rig.moved('a');
    yield* Effect.sleep(20);
    rig.more('a', 'run-1', 'r1', ' five');
    expect(tailOf((yield* next)[0])).toEqual({ restart: false, text: ' four', drop: 0 });
    expect((yield* next)[0]).toMatchObject({ type: 'changed', fields: { saidLine: 'said' } });
    expect(tailOf((yield* next)[0])).toEqual({ restart: false, text: ' five', drop: 0 });
  }),
);

it.live(
  'a stream through the limit repeatedly leaves the client with exactly the producer tail, non-BMP and split surrogates included',
  () =>
    Effect.gen(function* () {
      const rig = yield* world();
      rig.known.set('a', found('a', working('a')));
      const producerTail = (): string => {
        const open = rig.live.view('a').open[0] as unknown as { readonly text: string };
        return [...open.text].slice(-TAIL_CODE_POINTS).join('');
      };
      const next = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
      initial((yield* next)[0]);
      let client: PresenceTail | undefined;
      const follow = (event: PresenceEvent | undefined) => {
        const step = tailOf(event);
        if (step === null) throw new Error('The tail ended mid-stream.');
        client = applyTail(client, step);
        expect(client?.text).toBe(producerTail());
      };
      rig.think('a', 'run-1', 'r1', '😀');
      follow((yield* next)[0]);
      const pieces = ['😀é'.repeat(60), '\ud83d', '\ude00', 'x😀'.repeat(90), '𝒳'.repeat(200), 'tail'];
      for (const piece of [...pieces, ...pieces]) {
        rig.more('a', 'run-1', 'r1', piece);
        follow((yield* next)[0]);
      }

      const again = yield* Stream.toPull(rig.feed({ projectId: 1, threadIds: ['a'] }));
      let resumed = rowTail((yield* again)[0]);
      expect(resumed?.text).toBe(producerTail());
      rig.more('a', 'run-1', 'r1', '𝒳');
      follow((yield* next)[0]);
      resumed = applyTail(resumed, tailOf((yield* again)[0])!);
      expect(resumed?.text).toBe(producerTail());
    }),
);
