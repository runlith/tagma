import { Schema } from 'effect';

type Chord = {
  readonly mod: boolean;
  readonly cmd: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
};

export type HostChord = {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
};

export type Press = {
  readonly key: string;
  readonly code: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};

const MODIFIERS = ['Mod', 'Cmd', 'Ctrl', 'Alt', 'Shift'] as const;

const NAMED: ReadonlySet<string> = new Set([
  'Space',
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
]);

const FUNCTION_KEY = /^F(?:[1-9]|1[0-9]|2[0-4])$/u;

const isKey = (name: string): boolean => /^[A-Z0-9]$/u.test(name) || FUNCTION_KEY.test(name) || NAMED.has(name);

export function parseChord(text: string): Chord | null {
  const parts = text.split('+');
  const key = parts.pop();
  if (key === undefined || !isKey(key)) return null;
  const held = new Set<string>();
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || held.has(part)) return null;
    held.add(part);
  }
  return { mod: held.has('Mod'), cmd: held.has('Cmd'), ctrl: held.has('Ctrl'), alt: held.has('Alt'), shift: held.has('Shift'), key };
}

export const writeChord = (chord: Chord): string =>
  [chord.mod && 'Mod', chord.cmd && 'Cmd', chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', chord.key]
    .filter((part) => part !== false)
    .join('+');

const onHost = (chord: Chord, mac: boolean): HostChord => ({
  meta: chord.cmd || (chord.mod && mac),
  ctrl: chord.ctrl || (chord.mod && !mac),
  alt: chord.alt,
  shift: chord.shift,
  key: chord.key,
});

export const fromHost = (chord: HostChord, mac: boolean): Chord => ({
  mod: mac ? chord.meta : chord.ctrl,
  cmd: !mac && chord.meta,
  ctrl: mac && chord.ctrl,
  alt: chord.alt,
  shift: chord.shift,
  key: chord.key,
});

export const chordId = (chord: HostChord): string =>
  [chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', chord.meta && 'Cmd', chord.key]
    .filter((part) => part !== false)
    .join('+');

export const hostChordOf = (text: string, mac: boolean): HostChord | null => {
  const chord = parseChord(text);
  return chord === null ? null : onHost(chord, mac);
};

export const held = (chord: HostChord): boolean => chord.meta || chord.ctrl || chord.alt || FUNCTION_KEY.test(chord.key);

const PUNCTUATION: Readonly<Record<string, string>> = {
  '`': 'Backquote',
  '~': 'Backquote',
  '-': 'Minus',
  _: 'Minus',
  '=': 'Equal',
  '+': 'Equal',
  '[': 'BracketLeft',
  '{': 'BracketLeft',
  ']': 'BracketRight',
  '}': 'BracketRight',
  '\\': 'Backslash',
  '|': 'Backslash',
  ';': 'Semicolon',
  ':': 'Semicolon',
  "'": 'Quote',
  '"': 'Quote',
  ',': 'Comma',
  '<': 'Comma',
  '.': 'Period',
  '>': 'Period',
  '/': 'Slash',
  '?': 'Slash',
  ' ': 'Space',
};

const MODIFIER_CODE = /^(?:Meta|OS|Control|Alt|Shift|CapsLock|Fn)/u;

const logical = (key: string): string | null => {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if ((upper >= 'A' && upper <= 'Z') || (key >= '0' && key <= '9')) return upper;
    return PUNCTUATION[key] ?? null;
  }
  return NAMED.has(key) || FUNCTION_KEY.test(key) ? key : null;
};

const physical = (code: string): string | null => {
  const letter = /^Key([A-Z])$/u.exec(code)?.[1];
  if (letter !== undefined) return letter;
  const digit = /^(?:Digit|Numpad)([0-9])$/u.exec(code)?.[1];
  if (digit !== undefined) return digit;
  if (code === 'NumpadEnter') return 'Enter';
  return NAMED.has(code) || FUNCTION_KEY.test(code) ? code : null;
};

const dead = (key: string): boolean => key === '' || key === 'Dead' || key === 'Unidentified';

const composed = (key: string): boolean => Array.from(key).length === 1 && logical(key) === null;

//! The logical key decides, so ⌘Z is Z on AZERTY; the physical code decides only where the layout gives no Latin name.
function keyOf(press: Press, mac: boolean): string | null {
  if (MODIFIER_CODE.test(press.code)) return null;
  const name = logical(press.key);
  if (name !== null) return name;
  if (dead(press.key)) return physical(press.code);
  if (!composed(press.key)) return null;
  if (mac ? press.alt || press.meta : (press.ctrl || press.meta) && !press.alt) return physical(press.code);
  if (press.shift && /^Digit[0-9]$/u.test(press.code)) return physical(press.code);
  return null;
}

export const pressed = (press: Press, mac: boolean): HostChord | null => {
  const key = keyOf(press, mac);
  return key === null ? null : { meta: press.meta, ctrl: press.ctrl, alt: press.alt, shift: press.shift, key };
};

const ChordText = Schema.String.check(
  Schema.makeFilter((text: string) =>
    parseChord(text) === null
      ? `${text} is no chord: write modifiers (Mod, Cmd, Ctrl, Alt, Shift) and one key joined by +, like Mod+Alt+G`
      : true,
  ),
).annotate({
  description:
    'A chord: modifiers and one key joined by +, like Mod+Alt+G. Mod is ⌘ on macOS and Ctrl elsewhere; a key is A–Z, 0–9, F1–F24 or a name such as Enter, Space, Escape, ArrowUp, Comma, Slash or BracketLeft.',
});

export const HeldChordText = ChordText.check(
  Schema.makeFilter((text: string) => {
    const chord = parseChord(text);
    return chord === null || chord.mod || chord.cmd || chord.ctrl || chord.alt || FUNCTION_KEY.test(chord.key)
      ? true
      : `${text} needs Mod, Cmd, Ctrl or Alt, or a function key, so typing never runs it`;
  }),
);
