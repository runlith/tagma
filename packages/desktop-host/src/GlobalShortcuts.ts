import { globalShortcut } from 'electron';

type ShortcutChord = {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
};

export type Shortcut = {
  readonly chord: ShortcutChord;
  readonly press: () => void;
};

type Registration = { readonly kind: 'held' } | { readonly kind: 'taken' } | { readonly kind: 'refused'; readonly reason: string };

const HELD: Registration = { kind: 'held' };

const TAKEN: Registration = { kind: 'taken' };

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const PLAIN_KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/u;

function acceleratorOf(chord: ShortcutChord, mac: boolean): string | null {
  const key = KEY_NAMES[chord.key] ?? (PLAIN_KEY.test(chord.key) ? chord.key : null);
  if (key === null) return null;
  const meta = mac ? 'Command' : 'Super';
  return [chord.ctrl && 'Control', chord.alt && 'Alt', chord.shift && 'Shift', chord.meta && meta, key]
    .filter((part) => part !== false)
    .join('+');
}

export class GlobalShortcuts {
  private readonly held = new Map<string, string>();
  private readonly presses = new Map<string, () => void>();

  constructor(private readonly mac: boolean) {}

  set(wanted: ReadonlyMap<string, Shortcut>): ReadonlyMap<string, Registration> {
    for (const [id, accelerator] of this.held) {
      if (wanted.has(id)) continue;
      globalShortcut.unregister(accelerator);
      this.held.delete(id);
      this.presses.delete(id);
    }
    const answers = new Map<string, Registration>();
    for (const [id, shortcut] of wanted) {
      this.presses.set(id, shortcut.press);
      answers.set(id, this.held.has(id) ? HELD : this.register(id, shortcut.chord));
    }
    return answers;
  }

  dispose(): void {
    for (const accelerator of this.held.values()) globalShortcut.unregister(accelerator);
    this.held.clear();
    this.presses.clear();
  }

  private register(id: string, chord: ShortcutChord): Registration {
    const accelerator = acceleratorOf(chord, this.mac);
    if (accelerator === null) return { kind: 'refused', reason: `${chord.key} has no name a shortcut in every app can use.` };
    try {
      if (!globalShortcut.register(accelerator, () => this.presses.get(id)?.())) return TAKEN;
    } catch (error) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
    this.held.set(id, accelerator);
    return HELD;
  }
}
