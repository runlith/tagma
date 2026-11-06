import { chordId, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import { keptMenuChords } from './menuKeys.js';

const chordsOf = (texts: readonly string[]): ((mac: boolean) => ReadonlySet<string>) => {
  const on = (mac: boolean): ReadonlySet<string> => new Set(texts.flatMap((text) => hostChordOf(text, mac) ?? []).map(chordId));
  const [mac, other] = [on(true), on(false)];
  return (isMac) => (isMac ? mac : other);
};

export const NEW_WINDOW_CHORDS = chordsOf(['Mod+N']);

export const DEVTOOLS_CHORDS = chordsOf(['F12', 'Ctrl+Shift+I', 'Cmd+Shift+I', 'Cmd+Alt+I']);

export const keptChords = (platform: 'darwin' | 'linux' | 'win32'): readonly string[] => {
  const mac = platform === 'darwin';
  return [...keptMenuChords(mac), ...NEW_WINDOW_CHORDS(mac), ...DEVTOOLS_CHORDS(mac)];
};
