import { globalShortcut } from 'electron';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GlobalShortcuts, type Shortcut } from './GlobalShortcuts';

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

const wanted = (...entries: [string, string, (() => void)?][]): Map<string, Shortcut> =>
  new Map(entries.map(([id, accelerator, press]) => [id, { accelerator, press: press ?? (() => undefined) }]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalShortcut.register).mockReturnValue(true);
});

describe('GlobalShortcuts', () => {
  test('registers each accelerator and runs the press the set names', () => {
    const pressed = vi.fn();
    const shortcuts = new GlobalShortcuts();

    const answers = shortcuts.set(wanted(['Cmd+Shift+L', 'Shift+Command+L', pressed]));
    vi.mocked(globalShortcut.register).mock.calls[0]![1]();

    expect(globalShortcut.register).toHaveBeenCalledWith('Shift+Command+L', expect.any(Function));
    expect(answers.get('Cmd+Shift+L')).toEqual({ kind: 'held' });
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  test('answers taken for a chord another app holds, and takes it once a later set finds it free', () => {
    vi.mocked(globalShortcut.register).mockReturnValueOnce(false);
    const shortcuts = new GlobalShortcuts();
    const set = wanted(['Alt+Space', 'Alt+Space']);

    expect(shortcuts.set(set).get('Alt+Space')).toEqual({ kind: 'taken' });
    expect(shortcuts.set(set).get('Alt+Space')).toEqual({ kind: 'held' });
    shortcuts.set(set);

    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
  });

  test('unregisters what left the set and keeps what stayed', () => {
    const shortcuts = new GlobalShortcuts();
    shortcuts.set(wanted(['Ctrl+Shift+L', 'Control+Shift+L'], ['Alt+Space', 'Alt+Space']));

    shortcuts.set(wanted(['Alt+Space', 'Alt+Space']));

    expect(globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Control+Shift+L');
  });

  test('refuses an accelerator Electron rejects, naming why, instead of throwing', () => {
    vi.mocked(globalShortcut.register).mockImplementation(() => {
      throw new TypeError('Error processing argument at index 0');
    });

    const answers = new GlobalShortcuts().set(wanted(['Cmd+K', 'Command+K']));

    expect(answers.get('Cmd+K')).toEqual({ kind: 'refused', reason: 'Error processing argument at index 0' });
  });
});
