import { type HostChord, chordId } from '@tagma/server/platform/contract/wire/chord';

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

const KEYS: Readonly<Record<string, string>> = {
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Return: 'Enter',
  Esc: 'Escape',
};

function chordsOfAccelerator(text: string, mac: boolean): readonly HostChord[] {
  const parts = text.split('+');
  const named = parts.pop();
  if (named === undefined) return [];
  const held = new Set(parts.map((part) => part.toLowerCase()));
  const plus = named === 'Plus';
  const key = plus ? 'Equal' : (KEYS[named] ?? (named.length === 1 ? named.toUpperCase() : named));
  const command = held.has('command') || held.has('cmd') || ((held.has('commandorcontrol') || held.has('cmdorctrl')) && mac);
  const control = held.has('control') || held.has('ctrl') || ((held.has('commandorcontrol') || held.has('cmdorctrl')) && !mac);
  const chord: HostChord = {
    meta: command || held.has('super') || held.has('meta'),
    ctrl: control,
    alt: held.has('alt') || held.has('option'),
    shift: held.has('shift'),
    key,
  };
  return plus ? [{ ...chord, shift: true }, chord] : [chord];
}

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
