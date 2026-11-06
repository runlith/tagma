import { type HostChord, chordId } from '@tagma/server/platform/contract/wire/chord';
import { chordsOfAccelerator } from './accelerators.js';

type MenuEntry = {
  readonly role?: string | undefined;
  readonly accelerator?: string | null | undefined;
  readonly submenu?: { readonly items: readonly MenuEntry[] } | null | undefined;
};

const ROLES: Readonly<Record<string, (mac: boolean) => string | null>> = {
  close: () => 'CommandOrControl+W',
  copy: () => 'CommandOrControl+C',
  cut: () => 'CommandOrControl+X',
  paste: () => 'CommandOrControl+V',
  pasteandmatchstyle: () => 'Shift+CommandOrControl+V',
  selectall: () => 'CommandOrControl+A',
  undo: () => 'CommandOrControl+Z',
  redo: (mac) => (mac ? 'Shift+CommandOrControl+Z' : 'Control+Y'),
  hide: (mac) => (mac ? 'Command+H' : null),
  hideothers: (mac) => (mac ? 'Command+Alt+H' : null),
  minimize: () => 'CommandOrControl+M',
  quit: () => 'CommandOrControl+Q',
  reload: () => 'CommandOrControl+R',
  forcereload: () => 'Shift+CommandOrControl+R',
  resetzoom: () => 'CommandOrControl+0',
  zoomin: () => 'CommandOrControl+Plus',
  zoomout: () => 'CommandOrControl+-',
  toggledevtools: (mac) => (mac ? 'Alt+Command+I' : 'Control+Shift+I'),
  togglefullscreen: (mac) => (mac ? 'Control+Command+F' : 'F11'),
};

const KEPT_ROLES = ['quit', 'hide', 'hideothers', 'minimize', 'togglefullscreen'] as const;

const APPKIT_TAB_BAR: HostChord = { meta: true, ctrl: false, alt: false, shift: true, key: 'T' };

export function menuChords(items: readonly MenuEntry[], mac: boolean): ReadonlySet<string> {
  const chords = new Set<string>(mac ? [chordId(APPKIT_TAB_BAR)] : []);
  const walk = (entries: readonly MenuEntry[]): void => {
    for (const entry of entries) {
      const accelerator = entry.accelerator ?? ROLES[entry.role?.toLowerCase() ?? '']?.(mac);
      if (accelerator !== undefined && accelerator !== null && accelerator !== '') {
        for (const chord of chordsOfAccelerator(accelerator, mac)) chords.add(chordId(chord));
      }
      if (entry.submenu != null) walk(entry.submenu.items);
    }
  };
  walk(items);
  return chords;
}

export const keptMenuChords = (mac: boolean): readonly string[] =>
  KEPT_ROLES.flatMap((role) => {
    const accelerator = ROLES[role]!(mac);
    return accelerator === null ? [] : chordsOfAccelerator(accelerator, mac).map(chordId);
  });
