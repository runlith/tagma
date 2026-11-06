import { readsLight } from '@tagma/server/appearance/contract/wire/colour';
import type { ITheme, Terminal } from '@xterm/xterm';

export interface EngineOptions {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontWeightBold?: number;
  readonly lineHeight?: number;
  readonly scrollback?: number;
  readonly cursorStyle?: 'block' | 'underline' | 'bar';
  readonly cursorBlink?: boolean;
  readonly scrollSensitivity?: number;
  readonly fastScrollSensitivity?: number;
  readonly macOptionIsMeta?: boolean;
  readonly wordSeparator?: string;
  readonly theme?: ITheme;
  readonly ground?: string;
  readonly ligatures?: 'auto' | 'on' | 'off';
  readonly kittyKeyboard?: boolean;
  readonly onLinkClick?: (event: MouseEvent, uri: string) => void;
  readonly onLinkHover?: (event: MouseEvent, uri: string) => void;
  readonly onLinkLeave?: () => void;
  readonly attachWebgl?: (terminal: Terminal) => void;
}

const FALLBACK_FONTS = [
  'SF Mono',
  'Menlo',
  'Monaco',
  'Cascadia Mono',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Symbols Nerd Font Mono',
  'MesloLGS Nerd Font',
  'JetBrainsMono Nerd Font',
  'Hack Nerd Font',
  'monospace',
] as const;

type TerminalWithKittyKeyboard = Terminal & {
  _core?: { coreService?: { kittyKeyboard?: { flags?: number } } };
};

export function kittyKeyboardFlags(terminal: Terminal): number {
  const flags = (terminal as TerminalWithKittyKeyboard)._core?.coreService?.kittyKeyboard?.flags;
  return typeof flags === 'number' ? flags : 0;
}

export function terminalFontFamily(fontFamily: string | undefined): string {
  const chosen = fontFamily?.trim() ?? '';
  const parts = chosen ? [`"${chosen}"`] : [];
  const chosenLower = parts.map((part) => part.toLowerCase());
  for (const fallback of FALLBACK_FONTS) {
    if (!chosenLower.some((part) => part.includes(fallback.toLowerCase()))) {
      parts.push(fallback === 'monospace' ? fallback : `"${fallback}"`);
    }
  }
  return parts.join(', ');
}

const LIGHT_BACKGROUND_CONTRAST = 4.5;
const DARK_BACKGROUND_CONTRAST = 3;

export function terminalMinimumContrastRatio(background: string | undefined, ground: string | undefined): number {
  return readsLight(background, ground) ? LIGHT_BACKGROUND_CONTRAST : DARK_BACKGROUND_CONTRAST;
}

const LIGATURE_FONTS = [
  'fira code',
  'fira mono',
  'jetbrains mono',
  'jetbrainsmono',
  'cascadia code',
  'cascadia mono',
  'iosevka',
  'victor mono',
  'hasklig',
  'monoid',
  'operator mono',
  'dank mono',
  'mononoki',
  'pragmatapro',
  'recursive',
  'monolisa',
  'commit mono',
  'geist mono',
  'maple mono',
  'departure mono',
] as const;

export function ligaturesEnabled(mode: 'auto' | 'on' | 'off' | undefined, fontFamily: string | undefined): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const chosen = fontFamily?.split(',')[0]?.replace(/"/g, '').trim().toLowerCase() ?? '';
  return chosen !== '' && LIGATURE_FONTS.some((token) => chosen.includes(token));
}
