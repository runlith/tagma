import { describe, expect, test } from 'vitest';
import { ChatEntryView } from './ChatEntryView.svelte';
import { ChatFold } from './ChatFold.svelte';
import { FEED_MEMORY_THREADS, FeedMemory } from './FeedMemory';

type Stored = Record<string, Record<string, boolean>>;

const fold = new ChatFold();

function view(stored: Stored = {}, thread: string | null = 'thread-1', stretches: 'newest' | 'all' = 'newest') {
  const written: Stored[] = [];
  const stretchesWritten: ('newest' | 'all')[] = [];
  const entry = new ChatEntryView(new FeedMemory(stored), {
    fold: () => fold,
    copyText: async () => true,
    copyImage: async () => true,
    saveImage: async () => {},
    verbose: { read: () => false, write: () => undefined },
    stretches: {
      read: () => stretches,
      write: (value) => {
        stretchesWritten.push(value);
      },
    },
    disclosure: {
      read: () => stored,
      write: (threads) => {
        written.push(threads);
      },
    },
  });
  entry.openThread(thread);
  return { entry, written, stretchesWritten };
}

describe('ChatEntryView disclosures', () => {
  test('an untouched row falls back to what its own content decides', () => {
    const { entry } = view();
    expect(entry.expanded('tool:call-1')).toBe(false);
    expect(entry.expanded('tool:call-1', true)).toBe(true);
  });

  test('a hand beats the fallback in both directions', () => {
    const { entry } = view();
    entry.setExpanded('tool:call-1', false);
    expect(entry.expanded('tool:call-1', true)).toBe(false);
    entry.setExpanded('tool:call-2', true);
    expect(entry.expanded('tool:call-2', false)).toBe(true);
  });

  test('what was stored is what the reader left, and every change is written back', () => {
    const { entry, written } = view({ 'thread-1': { 'tool:call-1': false } });
    expect(entry.expanded('tool:call-1', true)).toBe(false);

    entry.setExpanded('tool:call-1', true);
    expect(written.at(-1)).toEqual({ 'thread-1': { 'tool:call-1': true } });
  });

  test('the stretches preference opens a past stretch, survives a fresh view, and is written on toggle', () => {
    const { entry: newest } = view();
    expect(newest.stretchDefault('activity:t1', false)).toBe(false);
    expect(newest.stretchDefault('activity:t9', true)).toBe(true);

    const { entry, written, stretchesWritten } = view({}, 'thread-1', 'all');
    expect(entry.stretchDefault('activity:t1', false)).toBe(true);
    expect(written).toEqual([]);

    entry.toggleStretches();
    expect(entry.stretches).toBe('newest');
    expect(entry.stretchDefault('activity:t1', false)).toBe(false);
    expect(stretchesWritten).toEqual(['newest']);
  });

  test('a held stretch answers open until released, and the hold dies with the thread', () => {
    const { entry, written } = view();
    expect(entry.stretchDefault('activity:t1', false)).toBe(false);

    entry.hold('activity:t1');
    expect(entry.stretchDefault('activity:t1', false)).toBe(true);
    expect(entry.held).toEqual(['activity:t1']);
    expect(written).toEqual([]);

    entry.release('activity:t1');
    expect(entry.stretchDefault('activity:t1', false)).toBe(false);

    entry.hold('activity:t2');
    entry.openThread('thread-2');
    expect(entry.held).toEqual([]);
  });

  test('a thread reads its own rows and leaves the last one where it stands', () => {
    const { entry, written } = view({ 'thread-1': { 'tool:call-1': true } });
    expect(entry.expanded('tool:call-1')).toBe(true);

    entry.openThread('thread-2');
    expect(entry.expanded('tool:call-1')).toBe(false);
    entry.setExpanded('tool:call-9', true);

    expect(written.at(-1)).toEqual({ 'thread-1': { 'tool:call-1': true }, 'thread-2': { 'tool:call-9': true } });
  });

  test('only the threads most recently touched are kept', () => {
    const { entry, written } = view();
    for (let index = 0; index <= FEED_MEMORY_THREADS; index += 1) {
      entry.openThread(`thread-${index}`);
      entry.setExpanded('tool:call-1', true);
    }

    const kept = Object.keys(written.at(-1) ?? {});
    expect(kept).toHaveLength(FEED_MEMORY_THREADS);
    expect(kept).not.toContain('thread-0');
    expect(kept).toContain(`thread-${FEED_MEMORY_THREADS}`);
  });

  test('a ready answer is picked by the next words of the reader, and a later pick does not move it', () => {
    const { entry } = view();
    fold.entries = [
      {
        id: 'ra-1',
        kind: 'ready-answers',
        runId: 'run-1',
        answers: [
          { label: 'Yes', send: 'yes' },
          { label: 'No', send: 'no' },
        ],
      },
      { id: 'tool-1', kind: 'tool', runId: 'run-1', toolName: 'bash', toolCallId: 'c', toolState: 'output-available' },
      { id: 'user-1', kind: 'user', text: ' no ' },
      { id: 'user-2', kind: 'user', text: 'yes' },
    ];

    expect(entry.readyAnswerPick('ra-1')).toBe(1);
  });
});
