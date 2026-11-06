export type KeyDefinition = {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text: string | undefined;
  readonly shifted: boolean;
  readonly location: number;
};

type Entry = {
  readonly code: string;
  readonly keyCode: number;
  readonly key: string;
  readonly shiftKey?: string;
  readonly text?: string;
  readonly location?: number;
};

const named: readonly Entry[] = [
  { code: 'Enter', keyCode: 13, key: 'Enter', text: '\r' },
  { code: 'NumpadEnter', keyCode: 13, key: 'Enter', text: '\r', location: 3 },
  { code: 'Tab', keyCode: 9, key: 'Tab' },
  { code: 'Backspace', keyCode: 8, key: 'Backspace' },
  { code: 'Escape', keyCode: 27, key: 'Escape' },
  { code: 'Delete', keyCode: 46, key: 'Delete' },
  { code: 'Insert', keyCode: 45, key: 'Insert' },
  { code: 'Home', keyCode: 36, key: 'Home' },
  { code: 'End', keyCode: 35, key: 'End' },
  { code: 'PageUp', keyCode: 33, key: 'PageUp' },
  { code: 'PageDown', keyCode: 34, key: 'PageDown' },
  { code: 'ArrowLeft', keyCode: 37, key: 'ArrowLeft' },
  { code: 'ArrowUp', keyCode: 38, key: 'ArrowUp' },
  { code: 'ArrowRight', keyCode: 39, key: 'ArrowRight' },
  { code: 'ArrowDown', keyCode: 40, key: 'ArrowDown' },
  { code: 'Space', keyCode: 32, key: ' ', text: ' ' },
  { code: 'ShiftLeft', keyCode: 16, key: 'Shift', location: 1 },
  { code: 'ControlLeft', keyCode: 17, key: 'Control', location: 1 },
  { code: 'AltLeft', keyCode: 18, key: 'Alt', location: 1 },
  { code: 'MetaLeft', keyCode: 91, key: 'Meta', location: 1 },
  { code: 'CapsLock', keyCode: 20, key: 'CapsLock' },
  { code: 'Semicolon', keyCode: 186, key: ';', shiftKey: ':' },
  { code: 'Equal', keyCode: 187, key: '=', shiftKey: '+' },
  { code: 'Comma', keyCode: 188, key: ',', shiftKey: '<' },
  { code: 'Minus', keyCode: 189, key: '-', shiftKey: '_' },
  { code: 'Period', keyCode: 190, key: '.', shiftKey: '>' },
  { code: 'Slash', keyCode: 191, key: '/', shiftKey: '?' },
  { code: 'Backquote', keyCode: 192, key: '`', shiftKey: '~' },
  { code: 'BracketLeft', keyCode: 219, key: '[', shiftKey: '{' },
  { code: 'Backslash', keyCode: 220, key: '\\', shiftKey: '|' },
  { code: 'BracketRight', keyCode: 221, key: ']', shiftKey: '}' },
  { code: 'Quote', keyCode: 222, key: "'", shiftKey: '"' },
];

const DIGIT_SHIFTED = ')!@#$%^&*(';

const entries: readonly Entry[] = [
  ...named,
  ...Array.from({ length: 10 }, (_, digit): Entry => ({
    code: `Digit${digit}`,
    keyCode: 48 + digit,
    key: String(digit),
    shiftKey: DIGIT_SHIFTED[digit],
  })),
  ...Array.from({ length: 26 }, (_, index): Entry => {
    const lower = String.fromCharCode(97 + index);
    return { code: `Key${lower.toUpperCase()}`, keyCode: 65 + index, key: lower, shiftKey: lower.toUpperCase() };
  }),
  ...Array.from({ length: 12 }, (_, index): Entry => ({ code: `F${index + 1}`, keyCode: 112 + index, key: `F${index + 1}` })),
];

const printable = (key: string): boolean => key.length === 1;

const SHIFTED = new Map<string, KeyDefinition>();

const LAYOUT: ReadonlyMap<string, KeyDefinition> = (() => {
  const table = new Map<string, KeyDefinition>();
  const put = (name: string, definition: KeyDefinition) => {
    if (!table.has(name)) table.set(name, definition);
  };
  for (const entry of entries) {
    const base: KeyDefinition = {
      key: entry.key,
      code: entry.code,
      keyCode: entry.keyCode,
      text: entry.text ?? (printable(entry.key) ? entry.key : undefined),
      shifted: false,
      location: entry.location ?? 0,
    };
    put(entry.key, base);
    put(entry.code, base);
    if (entry.shiftKey !== undefined) {
      const shifted: KeyDefinition = { ...base, key: entry.shiftKey, text: entry.shiftKey, shifted: true };
      put(entry.shiftKey, shifted);
      SHIFTED.set(entry.code, shifted);
    }
  }
  put('Shift', table.get('ShiftLeft')!);
  put('Control', table.get('ControlLeft')!);
  put('Alt', table.get('AltLeft')!);
  put('Meta', table.get('MetaLeft')!);
  return table;
})();

export const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;

export type Modifier = keyof typeof MODIFIERS;

export const keyOf = (name: string): KeyDefinition | undefined => {
  const known = LAYOUT.get(name);
  if (known !== undefined) return known;
  const glyph = name.normalize('NFC');
  if (
    !/^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]$/u.test(glyph) ||
    /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(glyph)
  )
    return undefined;
  return { key: glyph, code: '', keyCode: 0, text: name, shifted: false, location: 0 };
};

export type Chord = { readonly modifiers: readonly Modifier[]; readonly key: KeyDefinition };

export type ChordRefusal = { readonly unknown: string };

const ALIASES: Readonly<Record<string, Modifier>> = { Ctrl: 'Control', Cmd: 'Meta', Command: 'Meta', Option: 'Alt' };

export function chordOf(combo: string): Chord | ChordRefusal {
  const parts = combo === '+' ? ['+'] : combo.split('+').map((part, index, all) => (part === '' && index === all.length - 1 ? '+' : part));
  const named = parts.filter((part) => part !== '');
  const last = named.at(-1);
  if (last === undefined) return { unknown: combo };
  const modifiers: Modifier[] = [];
  for (const part of named.slice(0, -1)) {
    const modifier = ALIASES[part] ?? (part in MODIFIERS ? (part as Modifier) : undefined);
    if (modifier === undefined) return { unknown: part };
    modifiers.push(modifier);
  }
  const key = keyOf(last);
  if (key === undefined) return { unknown: last };
  const shifted = modifiers.includes('Shift') && !key.shifted ? SHIFTED.get(key.code) : undefined;
  return { modifiers, key: shifted ?? key };
}

export const modifierMask = (modifiers: readonly Modifier[], shifted: boolean): number =>
  modifiers.reduce((mask, modifier) => mask | MODIFIERS[modifier], shifted ? MODIFIERS.Shift : 0);
