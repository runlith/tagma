import { describe, expect, test } from 'vitest';
import { type ComposerPress, type ComposerState, composerIntent, rewindEscape } from './composerKeys';

function press(key: string, held: Partial<ComposerPress> = {}): ComposerPress {
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...held };
}

function state(over: Partial<ComposerState> = {}): ComposerState {
  return {
    canSend: true,
    running: false,
    menuOpen: false,
    menuQueues: false,
    cyclesMode: false,
    caretAtStart: true,
    caretAtEnd: true,
    browsing: false,
    hasHistory: false,
    ...over,
  };
}

const running: ComposerState = state({ running: true });
const idle: ComposerState = state();
const empty: ComposerState = state({ canSend: false, running: true });

describe('what one press of the composer means', () => {
  test('Enter sends, and while a turn is going that is the steer', () => {
    expect(composerIntent(press('Enter'), idle)).toBe('send');
    expect(composerIntent(press('Enter'), running)).toBe('send');
  });

  test('Cmd+Enter and Ctrl+Enter queue behind the turn that is going', () => {
    expect(composerIntent(press('Enter', { metaKey: true }), running)).toBe('queue');
    expect(composerIntent(press('Enter', { ctrlKey: true }), running)).toBe('queue');
  });

  test('Cmd+Enter with nothing running is an ordinary send', () => {
    expect(composerIntent(press('Enter', { metaKey: true }), idle)).toBe('send');
    expect(composerIntent(press('Enter', { ctrlKey: true }), idle)).toBe('send');
  });

  test('Tab always acts on the draft, and Shift+Tab stays the browser’s where no mode cycles', () => {
    expect(composerIntent(press('Tab'), running)).toBe('queue');
    expect(composerIntent(press('Tab'), idle)).toBe('send');
    expect(composerIntent(press('Tab', { shiftKey: true }), running)).toBe('none');
    expect(composerIntent(press('Tab', { shiftKey: true }), idle)).toBe('none');
    expect(composerIntent(press('Tab'), empty)).toBe('ignore');
  });

  test('Shift+Tab cycles the mode where the product has one, whatever the draft holds', () => {
    const cycling: ComposerState = state({ canSend: false, cyclesMode: true });
    expect(composerIntent(press('Tab', { shiftKey: true }), cycling)).toBe('cycle-mode');
    expect(composerIntent(press('Tab', { shiftKey: true }), { ...cycling, running: true })).toBe('cycle-mode');
    expect(composerIntent(press('Tab', { shiftKey: true }), { ...cycling, menuOpen: true })).toBe('none');
    expect(composerIntent(press('Tab'), { ...cycling, canSend: true })).toBe('send');
  });

  test('Shift+Enter is a newline, never a turn', () => {
    expect(composerIntent(press('Enter', { shiftKey: true }), running)).toBe('newline');
    expect(composerIntent(press('Enter', { shiftKey: true }), idle)).toBe('newline');
  });

  test('on a touch keyboard Return is a newline and the send button sends', () => {
    expect(composerIntent(press('Enter'), { ...idle, touch: true })).toBe('newline');
    expect(composerIntent(press('Enter'), { ...running, touch: true })).toBe('newline');
  });

  test('a press mid-composition belongs to the IME', () => {
    expect(composerIntent(press('Enter', { isComposing: true }), running)).toBe('none');
    expect(composerIntent(press('Enter', { isComposing: true, metaKey: true }), running)).toBe('none');
  });

  test('an empty draft sends and queues nothing', () => {
    expect(composerIntent(press('Enter'), empty)).toBe('none');
    expect(composerIntent(press('Enter', { metaKey: true }), empty)).toBe('none');
  });

  test('menu navigation cannot send or stop the run behind it; the queue gestures pick as a queue while it goes', () => {
    const menu: ComposerState = state({ running: true, menuOpen: true, menuQueues: true, cyclesMode: true });
    const idleMenu: ComposerState = state({ menuOpen: true, menuQueues: true });
    const mentionMenu: ComposerState = state({ running: true, menuOpen: true });
    expect(composerIntent(press('ArrowDown'), menu)).toBe('menu-next');
    expect(composerIntent(press('ArrowUp'), menu)).toBe('menu-previous');
    expect(composerIntent(press('Enter'), menu)).toBe('menu-pick');
    expect(composerIntent(press('Tab'), menu)).toBe('menu-queue');
    expect(composerIntent(press('Enter', { metaKey: true }), menu)).toBe('menu-queue');
    expect(composerIntent(press('Enter', { ctrlKey: true }), menu)).toBe('menu-queue');
    expect(composerIntent(press('Tab'), idleMenu)).toBe('menu-pick');
    expect(composerIntent(press('Tab'), mentionMenu)).toBe('menu-pick');
    expect(composerIntent(press('Enter', { metaKey: true }), mentionMenu)).toBe('none');
    expect(composerIntent(press('Enter', { metaKey: true }), idleMenu)).toBe('none');
    expect(composerIntent(press('Escape'), menu)).toBe('menu-back');
    expect(composerIntent(press('Enter', { shiftKey: true }), menu)).toBe('newline');
    expect(composerIntent(press('Tab', { shiftKey: true }), menu)).toBe('none');
    for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']) {
      expect(composerIntent(press(key, { isComposing: true }), menu)).toBe('none');
      expect(composerIntent(press(key, { isComposing: true }), running)).toBe('none');
    }
  });
});

describe('walking back through what was sent', () => {
  const recallable = state({ hasHistory: true });

  test('Up at the start recalls, and without a history it stays the browser’s', () => {
    expect(composerIntent(press('ArrowUp'), recallable)).toBe('history-previous');
    expect(composerIntent(press('ArrowUp'), state({ hasHistory: false }))).toBe('none');
  });

  test('a caret anywhere but the start leaves Up to the browser', () => {
    expect(composerIntent(press('ArrowUp'), state({ hasHistory: true, caretAtStart: false }))).toBe('none');
  });

  test('a menu over the field owns the arrows before the history does', () => {
    const menu = state({ hasHistory: true, menuOpen: true, browsing: true });
    expect(composerIntent(press('ArrowUp'), menu)).toBe('menu-previous');
    expect(composerIntent(press('ArrowDown'), menu)).toBe('menu-next');
  });

  test('Down steps forward only while a recalled prompt is showing', () => {
    expect(composerIntent(press('ArrowDown'), state({ hasHistory: true, browsing: true }))).toBe('history-next');
    expect(composerIntent(press('ArrowDown'), recallable)).toBe('none');
    expect(composerIntent(press('ArrowDown'), state({ hasHistory: true, browsing: true, caretAtEnd: false }))).toBe('none');
  });

  test('any modifier keeps the arrow the browser’s, and so do Ctrl+P and Ctrl+N', () => {
    for (const held of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
      expect(composerIntent(press('ArrowUp', held), recallable)).toBe('none');
      expect(composerIntent(press('ArrowDown', held), state({ hasHistory: true, browsing: true }))).toBe('none');
    }
    expect(composerIntent(press('p', { ctrlKey: true }), recallable)).toBe('none');
    expect(composerIntent(press('n', { ctrlKey: true }), state({ hasHistory: true, browsing: true }))).toBe('none');
  });

  test('Escape leaves the walk while one is on', () => {
    expect(composerIntent(press('Escape'), state({ hasHistory: true, browsing: true, running: true }))).toBe('history-leave');
    expect(composerIntent(press('Escape'), state({ hasHistory: true, browsing: true }))).toBe('history-leave');
  });

  test('a press mid-composition belongs to the IME, arrows included', () => {
    expect(composerIntent(press('ArrowUp', { isComposing: true }), recallable)).toBe('none');
    expect(composerIntent(press('ArrowDown', { isComposing: true }), state({ hasHistory: true, browsing: true }))).toBe('none');
  });
});

describe('the rewind keys of an empty composer', () => {
  const rewindable = state({ canSend: false, hasHistory: true, empty: true, rewinds: true });

  test('Up edits the last message ahead of recalling a prompt; with words in the field it recalls as before', () => {
    expect(composerIntent(press('ArrowUp'), rewindable)).toBe('edit-last');
    expect(composerIntent(press('ArrowUp'), { ...rewindable, empty: false })).toBe('history-previous');
  });

  test('a first Escape arms, a second within the window opens the picker; words in the field or a walk keep it shut', () => {
    const shut = { rewinds: true, empty: true, browsing: false, armed: false };
    expect(rewindEscape(shut)).toBe('arm');
    expect(rewindEscape({ ...shut, armed: true })).toBe('pick');
    expect(rewindEscape({ ...shut, empty: false })).toBe('none');
    expect(rewindEscape({ ...shut, browsing: true })).toBe('none');
  });

  test('while a turn goes, Up rewinds nothing', () => {
    expect(composerIntent(press('ArrowUp'), { ...rewindable, running: true })).toBe('history-previous');
  });

  test('Option+Up takes the newest waiting words back into an empty field; with words in it the press stays the browser’s', () => {
    const waiting = state({ running: true, empty: true, waiting: true });
    expect(composerIntent(press('ArrowUp', { altKey: true }), waiting)).toBe('take-waiting');
    expect(composerIntent(press('ArrowUp', { altKey: true }), { ...waiting, empty: false })).toBe('none');
    expect(composerIntent(press('ArrowUp', { altKey: true }), { ...waiting, waiting: false })).toBe('none');
  });
});
