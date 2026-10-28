import { describe, expect, test } from 'vitest';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { THREAD_TOOL_CONFIRM_KIND } from '@runlith/agent/transcript/parts';
import { ChatFold } from './ChatFold.svelte';
import { visibleChatEntries, VisibleFeed } from './VisibleFeed';
import type { ThreadToolState as ToolState } from '@runlith/agent/transcript/entries';
import type { ChatEntry } from './entries';
import { builtinEntryKinds } from './builtinKinds';

const kinds = builtinEntryKinds();

describe('attached context in the visible feed', () => {
  test('folds consecutive document pins into the following user message', () => {
    const entries: ChatEntry[] = [
      {
        id: 's1',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'TEST',
        text: 'body-test',
      },
      {
        id: 's2',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'HELLO',
        text: 'body-hello',
      },
      { id: 'u1', kind: 'user', text: 'что в файлах?' },
      { id: 'a1', kind: 'assistant', text: 'answer' },
    ];

    const folded = visibleChatEntries(kinds, entries, true);
    expect(folded).toHaveLength(2);
    expect(folded[0]).toMatchObject({
      kind: 'user',
      text: 'что в файлах?',
      attachedDocs: [
        { title: 'TEST', text: 'body-test' },
        { title: 'HELLO', text: 'body-hello' },
      ],
    });
    expect(folded[1]).toMatchObject({ kind: 'assistant', text: 'answer' });
  });

  test('does not break fold across system prompt / context bridge', () => {
    const entries: ChatEntry[] = [
      { id: 'sys', kind: 'system-prompt', text: 'prompt' },
      {
        id: 's1',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'test',
        text: 'body-test',
      },
      {
        id: 's2',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'hello',
        text: 'body-hello',
      },
      { id: 'ctx', kind: 'context', text: 'state' },
      { id: 'u1', kind: 'user', text: 'что в документах' },
    ];

    const folded = visibleChatEntries(kinds, entries, true);
    expect(folded.map((entry) => entry.kind)).toEqual(['system-prompt', 'context', 'user']);
    expect(folded[2]).toMatchObject({
      kind: 'user',
      attachedDocs: [
        { title: 'test', text: 'body-test' },
        { title: 'hello', text: 'body-hello' },
      ],
    });
  });

  test('groups orphan pins into one signal row', () => {
    const entries: ChatEntry[] = [
      {
        id: 's1',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'solo',
        text: 'body',
      },
      {
        id: 's2',
        kind: 'signal',
        signalType: 'attached-context',
        addressee: 'reader',
        title: 'two',
        text: 'body2',
      },
      { id: 'a1', kind: 'assistant', text: 'hi' },
    ];
    const folded = visibleChatEntries(kinds, entries, true);
    expect(folded).toHaveLength(2);
    expect(folded[0]).toMatchObject({
      kind: 'signal',
      signalType: 'attached-context',
      addressee: 'reader',
      attachedDocs: [
        { title: 'solo', text: 'body' },
        { title: 'two', text: 'body2' },
      ],
    });
    expect(folded[0]).not.toHaveProperty('title');
    expect(folded[1]).toMatchObject({ kind: 'assistant' });
  });

  test('the feed folded change by change equals the one read whole, and an untouched row keeps its object', () => {
    const pin = (id: string, runId: string): ChatEntry => ({
      id,
      kind: 'signal',
      signalType: 'attached-context',
      addressee: 'reader',
      title: id,
      text: 'doc',
      runId,
    });
    const ping = (id: string, runId: string): ChatEntry => ({
      id,
      kind: 'signal',
      signalType: KEEP_WARM_SIGNAL_TYPE,
      addressee: 'transport',
      text: 'warm',
      runId,
    });
    const ending = (runId: string): ChatEntry => ({
      id: `end-${runId}`,
      kind: 'run-end',
      runId,
      status: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:01Z',
      occurredAt: '2026-01-01T00:00:01Z',
    });
    const turn = (index: number): ChatEntry[] => [
      pin(`p${index}`, `run-${index}`),
      { id: `u${index}`, kind: 'user', text: 'look', runId: `run-${index}` },
      { id: `a${index}`, kind: 'assistant', text: 'seen', runId: `run-${index}` },
      ending(`run-${index}`),
    ];
    const settled = [
      ...turn(1),
      ping('k2', 'run-2'),
      { id: 'ok', kind: 'assistant', text: 'ok', runId: 'run-2' } as ChatEntry,
      ending('run-2'),
      ...turn(3),
    ];
    const answer = (text: string): ChatEntry => ({ id: 'a4', kind: 'assistant', text, runId: 'run-4', assistantState: 'streaming' });
    const asked = { id: 'u4', kind: 'user', text: 'more', runId: 'run-4' } as ChatEntry;
    const ready = { id: 'ra4', kind: 'ready-answers', runId: 'run-4', answers: [{ label: 'Yes', send: 'yes' }] } as ChatEntry;
    const reading = (state: ToolState): ChatEntry => ({
      id: 't4',
      kind: 'tool',
      runId: 'run-4',
      toolName: 'read',
      toolCallId: 't4',
      toolState: state,
    });
    const confirm = {
      id: 'q4',
      kind: 'question',
      runId: 'run-4',
      questionId: 'q4',
      toolCalls: [{ toolCallId: 't5', toolName: 'bash' }],
      prompts: [{ id: 't5', toolCallId: 't5', kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'run it?' }],
    } as ChatEntry;
    const steps: ChatEntry[][] = [
      settled,
      [...settled, pin('p4', 'run-4')],
      [...settled, pin('p4', 'run-4'), asked],
      [...settled, pin('p4', 'run-4'), asked, reading('input-available'), answer('a')],
      [...settled, pin('p4', 'run-4'), asked, reading('output-available'), answer('ab'), confirm],
      [...settled, pin('p4', 'run-4'), asked, reading('output-available'), answer('ab'), ready],
      [
        ...settled,
        pin('p4', 'run-4'),
        asked,
        reading('output-available'),
        answer('ab'),
        ready,
        { ...asked, id: 'u5', runId: 'run-5' } as ChatEntry,
      ],
      [...settled, ping('k5', 'run-5')],
      settled.slice(0, 6),
    ];
    const run = { id: 'run-4', phase: 'working' as const };
    const read = (feed: VisibleFeed) => ({
      rows: feed.rows.slice(),
      live: feed.live.slice(),
      users: feed.users,
      confirmations: feed.confirmations,
      trailing: feed.trailing,
    });
    for (const verbose of [false, true]) {
      const store = new ChatFold();
      const feed = new VisibleFeed(kinds);
      let previous: ChatEntry | undefined;
      for (const entries of steps) {
        store.entries = entries;
        feed.sync(store, verbose, run);
        const whole = new VisibleFeed(kinds);
        whole.load(entries, verbose, run);
        expect(read(feed)).toEqual(read(whole));
        const user = feed.rows.get('u1');
        if (previous !== undefined) expect(user).toBe(previous);
        previous = user;
      }
    }
  });
});

describe('the feed folded change by change stays the feed read whole', () => {
  const pin = (id: string, text = 'doc'): ChatEntry => ({
    id,
    kind: 'signal',
    signalType: 'attached-context',
    addressee: 'reader',
    title: id,
    text,
  });
  const confirmation = {
    id: 'q',
    kind: 'question',
    questionId: 'q',
    toolCalls: [{ toolCallId: 't', toolName: 'bash' }],
    prompts: [{ id: 't', toolCallId: 't', kind: THREAD_TOOL_CONFIRM_KIND, prompt: 'run it?' }],
  } as ChatEntry;
  const asked = { id: 'u', kind: 'user', text: 'look' } as ChatEntry;
  const read = (feed: VisibleFeed) => ({
    rows: feed.rows.slice(),
    live: feed.live.slice(),
    users: feed.users,
    confirmations: feed.confirmations,
    trailing: feed.trailing,
  });
  const whole = (entries: readonly ChatEntry[], verbose: boolean, run: { id: string; phase: 'working' } | null = null) => {
    const feed = new VisibleFeed(kinds);
    feed.load(entries, verbose, run);
    return read(feed);
  };

  test('a pin patched beside an open confirmation reaches the user it is folded into', () => {
    const store = new ChatFold();
    const feed = new VisibleFeed(kinds);
    store.entries = [pin('p'), confirmation, asked];
    feed.sync(store, true, null);
    const next = [pin('p', 'changed doc'), confirmation, asked];
    store.entries = next;
    feed.sync(store, true, null);
    expect(read(feed)).toEqual(whole(next, true));
    expect(feed.rows.get('u')).toMatchObject({ attachedDocs: [{ title: 'p', text: 'changed doc' }] });
  });

  test('a feed pointed at another source reads that source, whatever revision it stands at', () => {
    const first = new ChatFold();
    const second = new ChatFold();
    const feed = new VisibleFeed(kinds);
    first.entries = [{ id: 'a', kind: 'assistant', text: 'one' }];
    second.entries = [{ id: 'b', kind: 'assistant', text: 'two' }];
    expect(second.revision).toBe(first.revision);
    feed.sync(first, true, null);
    feed.sync(second, true, null);
    expect(feed.rows.slice().map((row) => row.id)).toEqual(['b']);
  });

  test('a run that starts or ends moves its entries between the rows and the live work, nothing else', () => {
    const tool = (state: ToolState): ChatEntry =>
      ({
        id: 't1',
        kind: 'tool',
        runId: 'run-2',
        toolName: 'read',
        toolCallId: 't1',
        toolState: state,
      }) as ChatEntry;
    const settled = [{ id: 'a1', kind: 'assistant', text: 'old', runId: 'run-1' } as ChatEntry];
    const entries = [...settled, { id: 'u2', kind: 'user', text: 'go', runId: 'run-2' } as ChatEntry, tool('input-available')];
    const store = new ChatFold();
    const feed = new VisibleFeed(kinds);
    store.entries = entries;
    const kept = (run: { id: string; phase: 'working' } | null) => {
      feed.sync(store, true, run);
      expect(read(feed)).toEqual(whole(entries, true, run));
    };
    kept(null);
    const before = feed.rows.get('a1');
    kept({ id: 'run-2', phase: 'working' });
    kept({ id: 'run-3', phase: 'working' });
    kept(null);
    expect(feed.rows.get('a1')).toBe(before);
  });

  test('a reload after a gap advances the epoch when only the trailing answers changed', () => {
    const store = new ChatFold();
    const feed = new VisibleFeed(kinds);
    const base = [asked];
    store.entries = base;
    feed.sync(store, true, null);
    const epoch = feed.epoch;
    for (let step = 0; step < 20; step += 1) store.entries = [...base, { id: `x${step}`, kind: 'assistant', text: 'x' } as ChatEntry];
    store.entries = [...base, { id: 'ra', kind: 'ready-answers', answers: [{ label: 'Yes', send: 'yes' }] } as ChatEntry];
    feed.sync(store, true, null);
    expect(feed.trailing?.id).toBe('ra');
    expect(feed.epoch).toBeGreaterThan(epoch);
  });
});
