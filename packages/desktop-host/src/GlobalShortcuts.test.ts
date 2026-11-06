import { globalShortcut } from 'electron';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GlobalShortcuts, type Shortcut } from './GlobalShortcuts';

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

const chord = (key: string, held: Partial<Shortcut['chord']> = {}): Shortcut['chord'] => ({
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  key,
  ...held,
});

const wanted = (...entries: [string, Shortcut['chord'], (() => void)?][]): Map<string, Shortcut> =>
  new Map(entries.map(([id, shortcut, press]) => [id, { chord: shortcut, press: press ?? (() => undefined) }]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalShortcut.register).mockReturnValue(true);
});

describe('GlobalShortcuts', () => {
  test('registers the accelerator of each chord and runs the press the set names', () => {
    const pressed = vi.fn();
    const shortcuts = new GlobalShortcuts(true);

    const answers = shortcuts.set(wanted(['Cmd+Shift+L', chord('L', { meta: true, shift: true }), pressed]));
    vi.mocked(globalShortcut.register).mock.calls[0]![1]();

    expect(globalShortcut.register).toHaveBeenCalledWith('Shift+Command+L', expect.any(Function));
    expect(answers.get('Cmd+Shift+L')).toEqual({ kind: 'held' });
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  test('answers taken for a chord another app holds, and takes it once a later set finds it free', () => {
    vi.mocked(globalShortcut.register).mockReturnValueOnce(false);
    const shortcuts = new GlobalShortcuts(true);
    const set = wanted(['Alt+Space', chord('Space', { alt: true })]);

    expect(shortcuts.set(set).get('Alt+Space')).toEqual({ kind: 'taken' });
    expect(shortcuts.set(set).get('Alt+Space')).toEqual({ kind: 'held' });
    shortcuts.set(set);

    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
  });

  test('unregisters what left the set and keeps what stayed', () => {
    const shortcuts = new GlobalShortcuts(false);
    shortcuts.set(wanted(['Ctrl+Shift+L', chord('L', { ctrl: true, shift: true })], ['Alt+Space', chord('Space', { alt: true })]));

    shortcuts.set(wanted(['Alt+Space', chord('Space', { alt: true })]));

    expect(globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Control+Shift+L');
  });

  test('refuses a chord Electron rejects, naming why, instead of throwing', () => {
    vi.mocked(globalShortcut.register).mockImplementation(() => {
      throw new TypeError('Error processing argument at index 0');
    });
    const shortcuts = new GlobalShortcuts(true);

    const answers = shortcuts.set(wanted(['Cmd+K', chord('K', { meta: true })], ['Cmd+Unknown', chord('Unknown', { meta: true })]));

    expect(answers.get('Cmd+K')).toEqual({ kind: 'refused', reason: 'Error processing argument at index 0' });
    expect(answers.get('Cmd+Unknown')).toMatchObject({ kind: 'refused' });
  });

  test('writes the accelerator Electron reads for named keys and the platform meta key', () => {
    new GlobalShortcuts(true).set(wanted(['a', chord('Backslash', { meta: true })], ['b', chord('F5', { ctrl: true })]));
    new GlobalShortcuts(false).set(wanted(['c', chord('ArrowUp', { meta: true, alt: true })]));

    expect(vi.mocked(globalShortcut.register).mock.calls.map(([accelerator]) => accelerator)).toEqual([
      'Command+\\',
      'Control+F5',
      'Alt+Super+Up',
    ]);
  });
});
