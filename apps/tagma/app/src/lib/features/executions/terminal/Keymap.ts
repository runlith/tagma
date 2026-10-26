import type { Chord } from '@tagma/desktop/bridge';
import { Host } from '@runlith/layer/Host';
import { Service } from '@runlith/layer/key';
import { spellChord } from '$lib/shared/chordSpelling.js';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';

export type KeymapPolicy = 'app-first' | 'terminal-first';

export type MacOptionAsAltSetting = 'auto' | 'true' | 'false' | 'left' | 'right';

export type LayoutCategory = 'us' | 'non-us' | 'unknown';

export type LayoutMapLike = {
  get(code: string): string | undefined;
  size: number;
};

export type TerminalAct =
  | { readonly _tag: 'copy' }
  | { readonly _tag: 'select-all' }
  | { readonly _tag: 'paste' }
  | { readonly _tag: 'search' }
  | { readonly _tag: 'clear' }
  | { readonly _tag: 'focus-next' }
  | { readonly _tag: 'focus-previous' }
  | { readonly _tag: 'expand-pane' }
  | { readonly _tag: 'equalize' }
  | { readonly _tag: 'set-title' }
  | { readonly _tag: 'clear-title' }
  | { readonly _tag: 'close-pane' }
  | { readonly _tag: 'split-right' }
  | { readonly _tag: 'split-down' }
  | { readonly _tag: 'zoom-in' }
  | { readonly _tag: 'zoom-out' }
  | { readonly _tag: 'zoom-reset' }
  | { readonly _tag: 'new-tab' }
  | { readonly _tag: 'reopen-tab' }
  | { readonly _tag: 'rename-tab' }
  | { readonly _tag: 'close-all-tabs' }
  | { readonly _tag: 'next-tab' }
  | { readonly _tag: 'previous-tab' }
  | { readonly _tag: 'previous-recent-tab' }
  | { readonly _tag: 'select-index'; readonly index: number }
  | { readonly _tag: 'toggle-terminals' }
  | { readonly _tag: 'scroll-top' }
  | { readonly _tag: 'scroll-bottom' };

export type TerminalActTag = TerminalAct['_tag'];

export type Resolution =
  | { readonly kind: 'act'; readonly act: TerminalAct }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'engine' };

export type KeymapEvent = {
  readonly key: string;
  readonly code?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly location?: number;
  readonly keyCode?: number;
};

export type ResolveContext = {
  readonly kitty?: boolean;
  readonly hasSelection?: boolean;
  readonly layout?: LayoutCategory;
  readonly inTerminal?: boolean;
};

const META_INPUT_SOURCE_IDS: ReadonlySet<string> = new Set(['com.apple.keylayout.us', 'com.apple.keylayout.usinternational-pc']);

const US_FINGERPRINT: Readonly<Record<string, string>> = {
  KeyQ: 'q',
  KeyW: 'w',
  KeyA: 'a',
  KeyZ: 'z',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
};

export function detectLayoutCategory(map: LayoutMapLike | null | undefined, inputSourceId?: string | null): LayoutCategory {
  if (inputSourceId !== undefined && inputSourceId !== null && inputSourceId !== '') {
    return META_INPUT_SOURCE_IDS.has(inputSourceId.toLowerCase()) ? 'us' : 'non-us';
  }
  if (map === null || map === undefined || map.size === 0) return 'unknown';
  for (const code of Object.keys(US_FINGERPRINT)) {
    const actual = map.get(code);
    if (actual === undefined) return 'unknown';
    if (actual !== US_FINGERPRINT[code]) return 'non-us';
  }
  return 'us';
}

export function effectiveMacOptionAsAlt(setting: MacOptionAsAltSetting, detected: LayoutCategory): 'true' | 'false' | 'left' | 'right' {
  return setting === 'auto' ? (detected === 'us' ? 'true' : 'false') : setting;
}

const ESC = String.fromCharCode(0x1b);
const CTRL_A = String.fromCharCode(0x01);
const CTRL_E = String.fromCharCode(0x05);
const CTRL_K = String.fromCharCode(0x0b);
const CTRL_U = String.fromCharCode(0x15);
const CTRL_W = String.fromCharCode(0x17);
const CR = String.fromCharCode(0x0d);
const DEL = String.fromCharCode(0x7f);
const CSI_SHIFT_ENTER = `${ESC}[13;2u`;
const CSI_CTRL_ENTER = `${ESC}[13;5u`;
const ESC_CR = `${ESC}${CR}`;
const ESC_DEL = `${ESC}${DEL}`;
const ESC_B = `${ESC}b`;
const ESC_F = `${ESC}f`;
const ESC_D = `${ESC}d`;

type PlatformName = 'darwin' | 'linux' | 'win32';

type ChordRow = {
  readonly tag: TerminalActTag;
  readonly act: TerminalAct;
  readonly scope: 'terminal' | 'tabs' | 'global';
  readonly allowInTerminal?: boolean;
  readonly outsideTerminal?: boolean;
  readonly digitIndex?: boolean;
  readonly darwin: readonly string[];
  readonly linux: readonly string[];
  readonly win32: readonly string[];
  readonly tab?: { readonly darwin: readonly string[]; readonly linux: readonly string[]; readonly win32: readonly string[] };
};

const CHORD_TABLE: readonly ChordRow[] = [
  {
    tag: 'copy',
    act: { _tag: 'copy' },
    scope: 'terminal',
    darwin: ['Mod+C'],
    linux: ['Ctrl+Shift+C', 'Ctrl+C'],
    win32: ['Ctrl+Shift+C', 'Ctrl+C'],
  },
  {
    tag: 'select-all',
    act: { _tag: 'select-all' },
    scope: 'terminal',
    darwin: ['Mod+A'],
    linux: ['Ctrl+Shift+A'],
    win32: ['Ctrl+Shift+A'],
  },
  {
    tag: 'paste',
    act: { _tag: 'paste' },
    scope: 'terminal',
    darwin: ['Mod+V'],
    linux: ['Ctrl+V', 'Ctrl+Shift+V', 'Shift+Insert'],
    win32: ['Ctrl+V', 'Ctrl+Shift+V', 'Shift+Insert'],
  },
  {
    tag: 'search',
    act: { _tag: 'search' },
    scope: 'terminal',
    darwin: ['Mod+F'],
    linux: ['Mod+F'],
    win32: ['Mod+F'],
  },
  {
    tag: 'clear',
    act: { _tag: 'clear' },
    scope: 'terminal',
    darwin: ['Mod+K'],
    linux: ['Mod+K'],
    win32: ['Mod+K'],
  },
  {
    tag: 'focus-next',
    act: { _tag: 'focus-next' },
    scope: 'terminal',
    darwin: ['Mod+BracketRight'],
    linux: ['Mod+BracketRight'],
    win32: ['Mod+BracketRight'],
  },
  {
    tag: 'focus-previous',
    act: { _tag: 'focus-previous' },
    scope: 'terminal',
    darwin: ['Mod+BracketLeft'],
    linux: ['Mod+BracketLeft'],
    win32: ['Mod+BracketLeft'],
  },
  {
    tag: 'equalize',
    act: { _tag: 'equalize' },
    scope: 'terminal',
    darwin: [],
    linux: [],
    win32: [],
  },
  {
    tag: 'expand-pane',
    act: { _tag: 'expand-pane' },
    scope: 'terminal',
    darwin: ['Mod+Shift+Enter'],
    linux: ['Mod+Shift+Enter'],
    win32: ['Mod+Shift+Enter'],
  },
  {
    tag: 'set-title',
    act: { _tag: 'set-title' },
    scope: 'terminal',
    darwin: [],
    linux: [],
    win32: [],
  },
  {
    tag: 'clear-title',
    act: { _tag: 'clear-title' },
    scope: 'terminal',
    darwin: [],
    linux: [],
    win32: [],
  },
  {
    tag: 'close-pane',
    act: { _tag: 'close-pane' },
    scope: 'terminal',
    darwin: ['Mod+W'],
    linux: ['Mod+W'],
    win32: ['Mod+W'],
    tab: { darwin: ['Alt+W'], linux: ['Alt+W'], win32: ['Alt+W'] },
  },
  {
    tag: 'split-right',
    act: { _tag: 'split-right' },
    scope: 'terminal',
    darwin: ['Mod+D'],
    linux: ['Mod+Shift+D'],
    win32: ['Mod+Shift+D'],
  },
  {
    tag: 'split-down',
    act: { _tag: 'split-down' },
    scope: 'terminal',
    darwin: ['Mod+Shift+D'],
    linux: ['Alt+Shift+D'],
    win32: ['Alt+Shift+D'],
  },
  {
    tag: 'zoom-in',
    act: { _tag: 'zoom-in' },
    scope: 'terminal',
    darwin: ['Mod+Equal', 'Mod+Shift+Equal'],
    linux: ['Mod+Equal', 'Mod+Shift+Equal'],
    win32: ['Mod+Equal', 'Mod+Shift+Equal'],
  },
  {
    tag: 'zoom-out',
    act: { _tag: 'zoom-out' },
    scope: 'terminal',
    darwin: ['Mod+Minus'],
    linux: ['Mod+Minus'],
    win32: ['Mod+Minus'],
  },
  {
    tag: 'zoom-reset',
    act: { _tag: 'zoom-reset' },
    scope: 'terminal',
    darwin: ['Mod+0'],
    linux: ['Mod+0'],
    win32: ['Mod+0'],
  },
  {
    tag: 'new-tab',
    act: { _tag: 'new-tab' },
    scope: 'tabs',
    darwin: ['Mod+T'],
    linux: ['Mod+T'],
    win32: ['Mod+T'],
    tab: { darwin: ['Alt+T'], linux: ['Alt+T'], win32: ['Alt+T'] },
  },
  {
    tag: 'reopen-tab',
    act: { _tag: 'reopen-tab' },
    scope: 'tabs',
    darwin: ['Mod+Shift+T'],
    linux: ['Mod+Shift+T'],
    win32: ['Mod+Shift+T'],
    tab: { darwin: ['Alt+Shift+W'], linux: ['Alt+Shift+W'], win32: ['Alt+Shift+W'] },
  },
  {
    tag: 'rename-tab',
    act: { _tag: 'rename-tab' },
    scope: 'tabs',
    darwin: ['Mod+R'],
    linux: [],
    win32: [],
    tab: { darwin: ['Alt+R'], linux: [], win32: [] },
  },
  {
    tag: 'close-all-tabs',
    act: { _tag: 'close-all-tabs' },
    scope: 'tabs',
    darwin: ['Mod+Alt+W'],
    linux: ['Mod+Alt+W'],
    win32: ['Mod+Alt+W'],
  },
  {
    tag: 'next-tab',
    act: { _tag: 'next-tab' },
    scope: 'tabs',
    allowInTerminal: true,
    darwin: ['Ctrl+PageDown'],
    linux: ['Ctrl+PageDown'],
    win32: ['Ctrl+PageDown'],
    tab: { darwin: ['Alt+PageDown'], linux: ['Alt+PageDown'], win32: ['Alt+PageDown'] },
  },
  {
    tag: 'previous-tab',
    act: { _tag: 'previous-tab' },
    scope: 'tabs',
    allowInTerminal: true,
    darwin: ['Ctrl+PageUp'],
    linux: ['Ctrl+PageUp'],
    win32: ['Ctrl+PageUp'],
    tab: { darwin: ['Alt+PageUp'], linux: ['Alt+PageUp'], win32: ['Alt+PageUp'] },
  },
  {
    tag: 'next-tab',
    act: { _tag: 'next-tab' },
    scope: 'tabs',
    darwin: ['Mod+Alt+BracketRight'],
    linux: ['Mod+Alt+BracketRight'],
    win32: ['Mod+Alt+BracketRight'],
  },
  {
    tag: 'previous-tab',
    act: { _tag: 'previous-tab' },
    scope: 'tabs',
    darwin: ['Mod+Alt+BracketLeft'],
    linux: ['Mod+Alt+BracketLeft'],
    win32: ['Mod+Alt+BracketLeft'],
  },
  {
    tag: 'previous-recent-tab',
    act: { _tag: 'previous-recent-tab' },
    scope: 'tabs',
    allowInTerminal: true,
    darwin: ['Ctrl+Tab'],
    linux: ['Ctrl+Tab'],
    win32: ['Ctrl+Tab'],
    tab: { darwin: ['Alt+Q'], linux: ['Alt+Q'], win32: ['Alt+Q'] },
  },
  {
    tag: 'select-index',
    act: { _tag: 'select-index', index: 0 },
    scope: 'tabs',
    digitIndex: true,
    darwin: ['Ctrl+1'],
    linux: ['Alt+1'],
    win32: ['Alt+1'],
    tab: { darwin: ['Ctrl+1'], linux: ['Alt+Shift+1'], win32: ['Alt+Shift+1'] },
  },
  {
    tag: 'toggle-terminals',
    act: { _tag: 'toggle-terminals' },
    scope: 'global',
    allowInTerminal: true,
    darwin: ['Mod+J'],
    linux: ['Ctrl+Backquote'],
    win32: ['Ctrl+Backquote'],
  },
  {
    tag: 'toggle-terminals',
    act: { _tag: 'toggle-terminals' },
    scope: 'global',
    outsideTerminal: true,
    darwin: [],
    linux: ['Ctrl+J'],
    win32: ['Ctrl+J'],
  },
];

type ParsedChord = {
  readonly mod: boolean;
  readonly meta: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
};

type CompiledRow = Omit<ChordRow, 'darwin' | 'linux' | 'win32' | 'tab'> & {
  readonly darwin: readonly ParsedChord[];
  readonly linux: readonly ParsedChord[];
  readonly win32: readonly ParsedChord[];
  readonly tab:
    | { readonly darwin: readonly ParsedChord[]; readonly linux: readonly ParsedChord[]; readonly win32: readonly ParsedChord[] }
    | undefined;
};

function parseChord(chord: string): ParsedChord {
  let mod = false;
  let meta = false;
  let control = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const part of chord.split('+')) {
    if (part === 'Mod') mod = true;
    else if (part === 'Cmd') meta = true;
    else if (part === 'Ctrl') control = true;
    else if (part === 'Alt') alt = true;
    else if (part === 'Shift') shift = true;
    else key = part;
  }
  return { mod, meta, control, alt, shift, key };
}

const CLIPBOARD: ReadonlySet<TerminalActTag> = new Set(['copy', 'paste', 'select-all']);

function staysUnderTerminalFirst(row: {
  readonly scope: 'terminal' | 'tabs' | 'global';
  readonly allowInTerminal?: boolean;
  readonly outsideTerminal?: boolean;
  readonly tag: TerminalActTag;
}): boolean {
  return row.scope === 'terminal' || row.allowInTerminal === true || row.outsideTerminal === true || CLIPBOARD.has(row.tag);
}

function logicalLetter(key: string): string | null {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return upper;
  }
  return null;
}

function logicalDigit(key: string): string | null {
  return key.length === 1 && key >= '0' && key <= '9' ? key : null;
}

function isDeadKey(key: string): boolean {
  return key === '' || key === 'Dead' || key === 'Unidentified';
}

function isComposedKey(key: string): boolean {
  return key.length === 1 && logicalLetter(key) === null && logicalDigit(key) === null && !isDeadKey(key);
}

const PUNCTUATION_OF_KEY: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  '=': 'Equal',
  '+': 'Equal',
  '-': 'Minus',
  _: 'Minus',
  '`': 'Backquote',
  '~': 'Backquote',
};

function matchLetter(
  letter: string,
  mods: { ctrl: boolean; meta: boolean; alt: boolean },
  event: KeymapEvent,
  isMac: boolean,
  chordAlt: boolean,
  expectedCtrl: boolean,
): boolean {
  const logical = logicalLetter(event.key);
  if (logical !== null) return logical === letter;
  if (!isMac && mods.ctrl && mods.alt && !expectedCtrl) return false;
  if (isDeadKey(event.key)) return event.code === `Key${letter}`;
  if (!isMac && (mods.ctrl || mods.meta) && !mods.alt && isComposedKey(event.key)) {
    return event.code === `Key${letter}`;
  }
  if (isMac && chordAlt && mods.alt) return event.code === `Key${letter}`;
  return false;
}

function matchDigit(
  digit: string,
  digitIndex: boolean,
  mods: { ctrl: boolean; meta: boolean; alt: boolean },
  event: KeymapEvent,
  isMac: boolean,
  chordAlt: boolean,
  expectedCtrl: boolean,
): boolean {
  const logical = logicalDigit(event.key);
  if (logical !== null) return digitIndex ? logical >= '1' && logical <= '9' : logical === digit;
  if (!isMac && mods.ctrl && mods.alt && !expectedCtrl) return false;
  const code = event.code ?? '';
  const physical = code.startsWith('Digit') && code.length === 6 ? code.slice(5) : null;
  if (physical === null) return false;
  if (isDeadKey(event.key)) return digitIndex ? physical >= '1' && physical <= '9' : physical === digit;
  if (!isMac && (mods.ctrl || mods.meta) && !mods.alt && isComposedKey(event.key)) {
    return digitIndex ? physical >= '1' && physical <= '9' : physical === digit;
  }
  if (isMac && chordAlt && mods.alt) {
    return digitIndex ? physical >= '1' && physical <= '9' : physical === digit;
  }
  return false;
}

function matchPunctuation(
  name: string,
  mods: { ctrl: boolean; meta: boolean; alt: boolean },
  event: KeymapEvent,
  isMac: boolean,
  chordAlt: boolean,
  expectedCtrl: boolean,
): boolean {
  const semantic = PUNCTUATION_OF_KEY[event.key];
  if (semantic !== undefined) return semantic === name;
  if (!isMac && mods.ctrl && mods.alt && !expectedCtrl) return false;
  if (isDeadKey(event.key)) return event.code === name;
  if (!isMac && (mods.ctrl || mods.meta) && !mods.alt && isComposedKey(event.key)) {
    return event.code === name;
  }
  if (isMac && chordAlt && mods.alt) return event.code === name;
  return false;
}

function matchKey(
  chord: ParsedChord,
  digitIndex: boolean,
  mods: { ctrl: boolean; meta: boolean; alt: boolean },
  event: KeymapEvent,
  isMac: boolean,
  expectedCtrl: boolean,
): boolean {
  const key = chord.key;
  if (key.length === 1 && key >= 'A' && key <= 'Z') {
    return matchLetter(key, mods, event, isMac, chord.alt, expectedCtrl);
  }
  if (key.length === 1 && key >= '0' && key <= '9') {
    return matchDigit(key, digitIndex, mods, event, isMac, chord.alt, expectedCtrl);
  }
  if (key === 'BracketLeft' || key === 'BracketRight' || key === 'Equal' || key === 'Minus' || key === 'Backquote') {
    return matchPunctuation(key, mods, event, isMac, chord.alt, expectedCtrl);
  }
  return event.key === key;
}

function matchChord(
  chord: ParsedChord,
  digitIndex: boolean,
  event: KeymapEvent,
  mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean },
  isMac: boolean,
): boolean {
  const expectedMeta = chord.meta || (chord.mod && isMac);
  const expectedCtrl = chord.control || (chord.mod && !isMac);
  if (mods.meta !== expectedMeta || mods.ctrl !== expectedCtrl || mods.alt !== chord.alt || mods.shift !== chord.shift) {
    return false;
  }
  return matchKey(chord, digitIndex, mods, event, isMac, expectedCtrl);
}

function nonLatinControlByte(event: KeymapEvent, mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }): string | null {
  if (!mods.ctrl || mods.meta || mods.alt || mods.shift) return null;
  if (Array.from(event.key).length !== 1 || (event.key.codePointAt(0) ?? 0) <= 0x7f) return null;
  const code = event.code ?? '';
  if (code.length !== 4 || !code.startsWith('Key')) return null;
  const letter = code.charAt(3);
  if (letter === 'C' || letter < 'A' || letter > 'Z') return null;
  return String.fromCharCode(letter.charCodeAt(0) - 0x40);
}

function isInterrupt(event: KeymapEvent, mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }): boolean {
  if (!mods.ctrl || mods.meta || mods.alt || mods.shift) return false;
  const logical = logicalLetter(event.key);
  if (logical !== null) return logical === 'C';
  return event.code === 'KeyC' || event.keyCode === 67;
}

function digitIndexOf(event: KeymapEvent): number {
  const logical = logicalDigit(event.key);
  if (logical !== null) return Number(logical) - 1;
  const code = event.code ?? '';
  if (code.startsWith('Digit') && code.length === 6) return Number(code.slice(5)) - 1;
  return 0;
}

const PC101_PUNCTUATION: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: ' ',
};

function optionBaseCharacter(event: KeymapEvent): string | null {
  const code = event.code ?? '';
  if (code.length === 4 && code.startsWith('Key')) {
    const letter = code.charAt(3);
    return letter >= 'A' && letter <= 'Z' ? letter.toLowerCase() : null;
  }
  if (code.length === 6 && code.startsWith('Digit')) {
    const digit = code.slice(5);
    return digit >= '0' && digit <= '9' ? digit : null;
  }
  return PC101_PUNCTUATION[code] ?? null;
}

const encoder = new TextEncoder();

function sendBytes(data: string): Resolution {
  return { kind: 'bytes', bytes: encoder.encode(data) };
}

const ENGINE: Resolution = { kind: 'engine' };
const INTERRUPT: Resolution = { kind: 'interrupt' };

function platformOf(host: Host): PlatformName {
  return host.apple ? 'darwin' : host.os === 'windows' ? 'win32' : 'linux';
}

function codeOfKey(key: string): string {
  if (logicalLetter(key) !== null) return `Key${key.toUpperCase()}`;
  if (logicalDigit(key) !== null) return `Digit${key}`;
  return key;
}

function spelled(chord: ParsedChord, isMac: boolean): string {
  return spellChord(
    {
      key: chord.key,
      meta: chord.meta || (chord.mod && isMac),
      ctrl: chord.control || (chord.mod && !isMac),
      alt: chord.alt,
      shift: chord.shift,
    },
    isMac,
  );
}

export class TerminalKeymap extends Service<TerminalKeymap>()('TerminalKeymap', { tier: 'app' }) {
  static *make() {
    const appearance = yield* TerminalAppearance;
    return new TerminalKeymap(
      yield* Host,
      () => appearance.keymapPolicy(),
      () => appearance.macOptionAsAlt(),
    );
  }

  private readonly table: readonly CompiledRow[];

  constructor(
    private readonly host: Host,
    readonly policy: () => KeymapPolicy = () => 'app-first',
    readonly macOptionAsAlt: () => MacOptionAsAltSetting = () => 'auto',
  ) {
    super();
    this.table = CHORD_TABLE.map((row) => ({
      ...row,
      darwin: row.darwin.map(parseChord),
      linux: row.linux.map(parseChord),
      win32: row.win32.map(parseChord),
      tab:
        row.tab === undefined
          ? undefined
          : {
              darwin: row.tab.darwin.map(parseChord),
              linux: row.tab.linux.map(parseChord),
              win32: row.tab.win32.map(parseChord),
            },
    }));
  }

  private chordsOf(row: CompiledRow, platform: PlatformName): readonly ParsedChord[] {
    if (this.host.kind === 'tab' && row.tab !== undefined) return row.tab[platform];
    return row[platform];
  }

  chords(tag: TerminalActTag): Chord[] {
    const platform = platformOf(this.host);
    const isMac = platform === 'darwin';
    return this.table
      .filter((row) => row.tag === tag)
      .flatMap((row) => this.chordsOf(row, platform))
      .map((chord) => ({
        code: codeOfKey(chord.key),
        meta: chord.meta || (chord.mod && isMac),
        ctrl: chord.control || (chord.mod && !isMac),
        alt: chord.alt,
        shift: chord.shift,
      }));
  }

  chordLabel(tag: TerminalActTag): string | null {
    const platform = platformOf(this.host);
    const row = this.table.find((row) => row.tag === tag);
    const chord = row === undefined ? undefined : this.chordsOf(row, platform)[0];
    return chord === undefined ? null : spelled(chord, platform === 'darwin');
  }

  resolve(event: KeymapEvent, context: ResolveContext = {}): Resolution {
    const platform = platformOf(this.host);
    const isMac = platform === 'darwin';
    const mods = {
      meta: event.metaKey ?? false,
      ctrl: event.ctrlKey ?? false,
      alt: event.altKey ?? false,
      shift: event.shiftKey ?? false,
    };

    for (const row of this.table) {
      if (event.repeat === true && row.tag !== 'select-all') continue;
      if (row.outsideTerminal === true && context.inTerminal === true) continue;
      for (const chord of this.chordsOf(row, platform)) {
        if (!matchChord(chord, row.digitIndex === true, event, mods, isMac)) continue;
        if (row.tag === 'copy' && !isMac && chord.key === 'C' && !chord.shift && context.hasSelection !== true) {
          continue;
        }
        if (this.policy() === 'terminal-first' && !staysUnderTerminalFirst(row)) return ENGINE;
        if (row.tag === 'select-index') {
          return { kind: 'act', act: { _tag: 'select-index', index: digitIndexOf(event) } };
        }
        return { kind: 'act', act: row.act };
      }
    }

    if (isInterrupt(event, mods)) return INTERRUPT;
    const controlByte = nonLatinControlByte(event, mods);
    if (controlByte !== null) return sendBytes(controlByte);

    if (mods.shift && !mods.meta && !mods.ctrl && !mods.alt && event.key === 'Enter') {
      return sendBytes(context.kitty === true ? CSI_SHIFT_ENTER : ESC_CR);
    }
    if (mods.ctrl && !mods.meta && !mods.alt && !mods.shift && event.key === 'Enter') {
      return sendBytes(CSI_CTRL_ENTER);
    }
    if (mods.ctrl && !mods.meta && !mods.alt && !mods.shift && event.key === 'Backspace') {
      return sendBytes(CTRL_W);
    }

    if (isMac && mods.meta && !mods.ctrl && !mods.alt && !mods.shift) {
      if (event.key === 'Backspace') return sendBytes(CTRL_U);
      if (event.key === 'Delete') return sendBytes(CTRL_K);
      if (event.key === 'ArrowLeft') return sendBytes(CTRL_A);
      if (event.key === 'ArrowRight') return sendBytes(CTRL_E);
      if (event.key === 'ArrowUp') return { kind: 'act', act: { _tag: 'scroll-top' } };
      if (event.key === 'ArrowDown') return { kind: 'act', act: { _tag: 'scroll-bottom' } };
    }

    if (!mods.meta && !mods.ctrl && mods.alt && !mods.shift && event.key === 'Backspace') {
      return context.kitty === true ? ENGINE : sendBytes(ESC_DEL);
    }
    if (
      !mods.meta &&
      !mods.ctrl &&
      mods.alt &&
      !mods.shift &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      event.code?.startsWith('Numpad') !== true
    ) {
      if (context.kitty === true) return ENGINE;
      return sendBytes(event.key === 'ArrowLeft' ? ESC_B : ESC_F);
    }
    if (!isMac && !mods.meta && mods.ctrl && !mods.alt && !mods.shift && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      return sendBytes(event.key === 'ArrowLeft' ? ESC_B : ESC_F);
    }

    if (isMac && !mods.meta && !mods.ctrl && mods.alt) {
      if (context.kitty === true) return ENGINE;
      const effective = effectiveMacOptionAsAlt(this.macOptionAsAlt(), context.layout ?? 'unknown');
      const location = event.location ?? 0;
      const metaSide = effective === 'true' || (effective === 'left' && location === 1) || (effective === 'right' && location === 2);
      if (!mods.shift) {
        if (metaSide) {
          const character = optionBaseCharacter(event);
          if (character !== null) return sendBytes(`${ESC}${character}`);
        } else if (event.code === 'KeyB' || event.code === 'KeyF' || event.code === 'KeyD') {
          return sendBytes(event.code === 'KeyB' ? ESC_B : event.code === 'KeyF' ? ESC_F : ESC_D);
        }
      }
      return ENGINE;
    }

    return ENGINE;
  }
}
