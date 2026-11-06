import { chordId, type HostChord, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import { describe, expect, test } from 'vitest';
import { globalOf, type Keyed, type PersonKeys, resolveKeys, takeChord } from './resolve.js';

const chord = (text: string): HostChord => {
  const parsed = hostChordOf(text, true);
  if (parsed === null) throw new Error(`no chord ${text}`);
  return parsed;
};

const action = (id: string, keys: readonly string[], more: Partial<Keyed> = {}): Keyed => ({
  id,
  place: 'window',
  hold: false,
  rank: null,
  defaults: keys.map((text) => ({ chord: chord(text.replace(/^\*/u, '')), global: text.startsWith('*') })),
  ...more,
});

const bound = (actions: readonly Keyed[], person: PersonKeys = {}, kept: readonly string[] = []) => {
  const table = resolveKeys(actions, person, kept.map(chord));
  return {
    table,
    holds: (text: string) =>
      table.bindings.filter((binding) => chordId(binding.chord) === chordId(chord(text))).map((binding) => binding.action),
    global: (id: string) =>
      table.bindings.filter((binding) => binding.action === id && binding.global).map((binding) => chordId(binding.chord)),
  };
};

describe('resolveKeys', () => {
  test('the person wins over Tagma, Tagma over plugins, and the earlier installed plugin over the later', () => {
    const find = action('palette.open', ['Mod+K']);
    const boards = action('plugin.boards.open', ['Mod+K', 'Mod+Alt+B'], { rank: 1 });
    const early = action('plugin.early.open', ['Mod+Alt+B'], { rank: 0 });
    const mine = { 'thread.new': [{ chord: chord('Mod+K'), global: false }] };
    const { holds, table } = bound([find, boards, early, action('thread.new', [])], mine);
    expect(holds('Mod+K')).toEqual(['thread.new']);
    expect(holds('Mod+Alt+B')).toEqual(['plugin.early.open']);
    expect(table.displaced.map((one) => [one.action, chordId(one.chord), one.by])).toEqual([
      ['palette.open', 'Cmd+K', { kind: 'action', action: 'thread.new' }],
      ['plugin.boards.open', 'Cmd+K', { kind: 'action', action: 'thread.new' }],
      ['plugin.boards.open', 'Alt+Cmd+B', { kind: 'action', action: 'plugin.early.open' }],
    ]);
  });

  test('a global displaces every local binding on its chord, and a region binding only shadows a window one', () => {
    const hide = action('tagma.hide', ['*Mod+Shift+L']);
    const local = action('plugin.lists.open', ['Mod+Shift+L'], { rank: 0 });
    const clear = action('terminal.clear', ['Mod+K'], { place: 'terminal' });
    const find = action('palette.open', ['Mod+K']);
    const { holds, table } = bound([hide, local, clear, find]);
    expect(holds('Mod+Shift+L')).toEqual(['tagma.hide']);
    expect(holds('Mod+K')).toEqual(['terminal.clear', 'palette.open']);
    expect(table.displaced.map((one) => one.action)).toEqual(['plugin.lists.open']);
  });

  test('the shell keeps its chords from every place', () => {
    const { table } = bound([action('browser.open', ['Mod+T']), action('terminal.new-tab', ['Mod+T'], { place: 'terminal' })], {}, [
      'Mod+T',
    ]);
    expect(table.bindings).toEqual([]);
    expect(table.displaced.map((one) => one.by)).toEqual([{ kind: 'shell' }, { kind: 'shell' }]);
  });

  test('a capture that takes a held chord records the move in the person layer', () => {
    const find = action('palette.open', ['Mod+K']);
    const fresh = action('thread.new', []);
    const actions = [find, fresh];
    const { table } = bound(actions);
    const person = takeChord(table, actions, {}, { keyed: fresh, chord: chord('Mod+K'), global: false, mode: 'replace' });
    expect(Object.fromEntries(Object.entries(person).map(([id, chosen]) => [id, chosen.map((one) => chordId(one.chord))]))).toEqual({
      'palette.open': [],
      'thread.new': ['Cmd+K'],
    });
    expect(bound(actions, person).table.displaced).toEqual([]);
  });

  test('a plugin chord asked for every app stays in the window until the person allows it', () => {
    const boards = action('plugin.boards.open', ['*Mod+Alt+G'], { rank: 0 });
    const before = bound([boards]);
    expect(before.global('plugin.boards.open')).toEqual([]);
    expect(before.table.bindings.map((binding) => binding.offered)).toEqual([true]);
    const person = globalOf(before.table, boards, chord('Mod+Alt+G'), true, {});
    expect(bound([boards], person).global('plugin.boards.open')).toEqual(['Alt+Cmd+G']);
    expect(globalOf(bound([boards], person).table, boards, chord('Mod+Alt+G'), false, person)).toEqual({});
  });
});
