import { describe, expect, test } from 'vitest';
import { PROMPT_HISTORY_MAX, PromptHistory, type PromptHistoryEntry, type PromptHistoryStore } from './PromptHistory';

class Record implements PromptHistoryStore {
  entries: readonly PromptHistoryEntry[];

  constructor(texts: readonly string[] = []) {
    this.entries = texts.map((text, index) => ({ text, at: 1000 - index }));
  }

  read(): readonly PromptHistoryEntry[] {
    return this.entries;
  }

  write(entries: readonly PromptHistoryEntry[]): void {
    this.entries = entries;
  }

  get texts(): readonly string[] {
    return this.entries.map((entry) => entry.text);
  }
}

describe('walking the prompts already sent', () => {
  test('Up steps back and clamps at the oldest, Down comes forward to the draft it started from', () => {
    const history = new PromptHistory(new Record(['C', 'B', 'A']));

    expect(history.previous('x')).toBe('C');
    expect(history.index).toBe(0);
    expect(history.previous('x')).toBe('B');
    expect(history.previous('x')).toBe('A');
    expect(history.previous('x')).toBe('A');
    expect(history.index).toBe(2);

    expect(history.next()).toBe('B');
    expect(history.next()).toBe('C');
    expect(history.next()).toBe('x');
    expect(history.index).toBeNull();
    expect(history.next()).toBeNull();
  });

  test('an empty record recalls nothing and stashes nothing', () => {
    const history = new PromptHistory(new Record());

    expect(history.previous('x')).toBeNull();
    expect(history.index).toBeNull();
    expect(history.leave()).toBeNull();
  });

  test('Escape mid-walk gives the draft back, and typing ends the walk keeping nothing', () => {
    const history = new PromptHistory(new Record(['C', 'B', 'A']));

    history.previous('half a thought');
    history.previous('half a thought');
    expect(history.leave()).toBe('half a thought');
    expect(history.index).toBeNull();

    history.previous('typed again');
    history.edited();
    expect(history.index).toBeNull();
    expect(history.leave()).toBeNull();
    expect(history.previous('third')).toBe('C');
  });

  test('a walk reads the record again, so another tab’s sends are in it', () => {
    const record = new Record(['C']);
    const history = new PromptHistory(record);

    expect(history.previous('')).toBe('C');
    history.leave();
    record.entries = [{ text: 'D', at: 2000 }, ...record.entries];

    expect(history.previous('')).toBe('D');
  });
});

describe('recording what the chat accepted', () => {
  test('a blank and the prompt already newest change nothing', () => {
    const record = new Record(['C', 'B', 'A']);
    const history = new PromptHistory(record);

    history.record('C');
    history.record('   ');
    history.record('');
    expect(record.texts).toEqual(['C', 'B', 'A']);
  });

  test('a prompt lands newest, trimmed, and an older one re-sent moves to the front', () => {
    const record = new Record(['C', 'B', 'A']);
    const history = new PromptHistory(record);

    history.record('  D  ');
    expect(record.texts).toEqual(['D', 'C', 'B', 'A']);

    history.record('B');
    expect(record.texts).toEqual(['B', 'D', 'C', 'B', 'A']);
  });

  test('the record stops at its cap, losing the oldest', () => {
    const record = new Record();
    const history = new PromptHistory(record);

    for (let index = 0; index <= PROMPT_HISTORY_MAX; index += 1) history.record(`prompt ${index}`);

    expect(record.texts).toHaveLength(PROMPT_HISTORY_MAX);
    expect(record.texts[0]).toBe(`prompt ${PROMPT_HISTORY_MAX}`);
    expect(record.texts.at(-1)).toBe('prompt 1');
  });

  test('a record written by another tab is not overwritten by this one’s idea of it', () => {
    const record = new Record(['C']);
    const history = new PromptHistory(record);

    record.entries = [{ text: 'D', at: 2000 }, ...record.entries];
    history.record('E');

    expect(record.texts).toEqual(['E', 'D', 'C']);
  });
});
