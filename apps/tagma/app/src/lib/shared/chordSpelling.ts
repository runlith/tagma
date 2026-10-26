export type SpelledChord = {
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};

const PUNCTUATION: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
};

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const MAC_KEYS: Readonly<Record<string, string>> = {
  ...PUNCTUATION,
  ...ARROWS,
  Enter: '↩',
  Tab: '⇥',
  Escape: 'esc',
  Backspace: '⌫',
  PageUp: '⇞',
  PageDown: '⇟',
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
  ...PUNCTUATION,
  ...ARROWS,
  Escape: 'Esc',
};

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

const MAC_SIGNS: Readonly<Record<Modifier, string>> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
const OTHER_WORDS: Readonly<Record<Modifier, string>> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Cmd' };

const MAC_MODIFIERS: ReadonlySet<string> = new Set(Object.values(MAC_SIGNS));
const WORD_MODIFIER = new RegExp(`^(${Object.values(OTHER_WORDS).join('|')})\\+`);

export const spellModifier = (modifier: Modifier, isMac: boolean): string => (isMac ? MAC_SIGNS : OTHER_WORDS)[modifier];

export function chordKeys(spelled: string): readonly string[] {
  const keys: string[] = [];
  let rest = spelled.trim();
  while (rest.length > 1) {
    const glyph = rest.charAt(0);
    if (MAC_MODIFIERS.has(glyph)) {
      keys.push(glyph);
      rest = rest.slice(1).trimStart();
      continue;
    }
    const word = WORD_MODIFIER.exec(rest);
    if (word === null || word[0].length === rest.length) break;
    keys.push(word[1]!);
    rest = rest.slice(word[0].length);
  }
  if (rest !== '') keys.push(rest);
  return keys;
}

export function keyOfCode(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.charAt(3).toLowerCase();
  if (code.startsWith('Digit') && code.length === 6) return code.charAt(5);
  return code;
}

export const spellKey = (code: string, isMac: boolean): string =>
  spellChord({ key: keyOfCode(code), meta: false, ctrl: false, alt: false, shift: false }, isMac);

export function spellChord(chord: SpelledChord, isMac: boolean): string {
  const order: readonly Modifier[] = isMac ? ['ctrl', 'alt', 'shift', 'meta'] : ['ctrl', 'meta', 'alt', 'shift'];
  const held = order.filter((modifier) => chord[modifier]).map((modifier) => spellModifier(modifier, isMac));
  const key = (isMac ? MAC_KEYS : OTHER_KEYS)[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return isMac ? `${held.join('')}${key}` : [...held, key].join('+');
}
