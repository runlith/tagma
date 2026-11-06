import type { Press } from '@tagma/server/platform/contract/wire/chord';
import { Host } from '@runlith/layer/Host';
import { Service } from '@runlith/layer/key';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { WINDOW } from '$lib/app/keys/resolve.js';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import { actOf, TERMINAL, TOGGLE } from './actions.js';

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

type Mods = { readonly meta: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean };

const YIELDING: ReadonlySet<TerminalAct['_tag']> = new Set(['new-tab', 'reopen-tab', 'rename-tab', 'close-all-tabs', 'select-index']);

//! Under terminal-first the program gets tab acts, except tab switching by Ctrl+PageUp/PageDown, which programs rarely read.
function yields(act: TerminalAct, press: Press): boolean {
  if (YIELDING.has(act._tag)) return true;
  return (act._tag === 'next-tab' || act._tag === 'previous-tab') && press.key !== 'PageDown' && press.key !== 'PageUp';
}

function logicalLetter(key: string): string | null {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return upper;
  }
  return null;
}

const controlLetter = (press: Press): boolean =>
  press.ctrl && !press.meta && !press.alt && !press.shift && (logicalLetter(press.key) !== null || /^Key[A-Z]$/u.test(press.code));

function nonLatinControlByte(event: KeymapEvent, mods: Mods): string | null {
  if (!mods.ctrl || mods.meta || mods.alt || mods.shift) return null;
  if (Array.from(event.key).length !== 1 || (event.key.codePointAt(0) ?? 0) <= 0x7f) return null;
  const code = event.code ?? '';
  if (code.length !== 4 || !code.startsWith('Key')) return null;
  const letter = code.charAt(3);
  if (letter === 'C' || letter < 'A' || letter > 'Z') return null;
  return String.fromCharCode(letter.charCodeAt(0) - 0x40);
}

function isInterrupt(event: KeymapEvent, mods: Mods): boolean {
  if (!mods.ctrl || mods.meta || mods.alt || mods.shift) return false;
  const logical = logicalLetter(event.key);
  if (logical !== null) return logical === 'C';
  return event.code === 'KeyC' || event.keyCode === 67;
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
const TOGGLING: Resolution = { kind: 'act', act: { _tag: 'toggle-terminals' } };

export class TerminalKeymap extends Service<TerminalKeymap>()('TerminalKeymap', { tier: 'app' }) {
  static *make() {
    const appearance = yield* TerminalAppearance;
    return new TerminalKeymap(
      yield* Host,
      yield* Keymap,
      () => appearance.keymapPolicy(),
      () => appearance.macOptionAsAlt(),
    );
  }

  constructor(
    private readonly host: Host,
    private readonly keys: Keymap,
    readonly policy: () => KeymapPolicy = () => 'app-first',
    readonly macOptionAsAlt: () => MacOptionAsAltSetting = () => 'auto',
  ) {
    super();
  }

  private act(event: KeymapEvent, press: Press, context: ResolveContext): Resolution | null {
    const act = actOf(this.keys.actionOf(press, TERMINAL) ?? '');
    const copyWithout = act?._tag === 'copy' && !this.host.apple && controlLetter(press) && context.hasSelection !== true;
    if (act !== null && (event.repeat !== true || act._tag === 'select-all') && !copyWithout) {
      return this.policy() === 'terminal-first' && yields(act, press) ? ENGINE : { kind: 'act', act };
    }
    if (event.repeat === true || this.keys.actionOf(press, WINDOW) !== TOGGLE) return null;
    return context.inTerminal === true && controlLetter(press) ? null : TOGGLING;
  }

  resolve(event: KeymapEvent, context: ResolveContext = {}): Resolution {
    const isMac = this.host.apple;
    const mods: Mods = {
      meta: event.metaKey ?? false,
      ctrl: event.ctrlKey ?? false,
      alt: event.altKey ?? false,
      shift: event.shiftKey ?? false,
    };
    const acted = this.act(event, { key: event.key, code: event.code ?? '', ...mods }, context);
    if (acted !== null) return acted;

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
