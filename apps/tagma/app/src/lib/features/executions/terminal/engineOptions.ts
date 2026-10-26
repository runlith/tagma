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
  readonly surface?: 'dark' | 'light';
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

export function terminalMinimumContrastRatio(background: string | undefined, surface: 'dark' | 'light'): number {
  const composited = compositeBackground(background, surface);
  if (!composited) return DARK_BACKGROUND_CONTRAST;
  const againstBlack = contrastRatio({ r: 0, g: 0, b: 0 }, composited);
  const againstWhite = contrastRatio({ r: 255, g: 255, b: 255 }, composited);
  return againstBlack >= againstWhite ? LIGHT_BACKGROUND_CONTRAST : DARK_BACKGROUND_CONTRAST;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const SURFACE_COLORS: Record<'dark' | 'light', Rgb> = {
  dark: { r: 10, g: 10, b: 10 },
  light: { r: 255, g: 255, b: 255 },
};

const NAMED_BACKGROUNDS: Record<string, { rgb: Rgb; alpha: number }> = {
  black: { rgb: { r: 0, g: 0, b: 0 }, alpha: 1 },
  white: { rgb: { r: 255, g: 255, b: 255 }, alpha: 1 },
  transparent: { rgb: { r: 0, g: 0, b: 0 }, alpha: 0 },
};

function compositeBackground(background: string | undefined, surface: 'dark' | 'light'): Rgb | null {
  const parsed = parseColor(background);
  if (!parsed) return null;
  if (parsed.alpha >= 1) return parsed.rgb;
  const over = SURFACE_COLORS[surface];
  const alpha = Math.min(1, Math.max(0, parsed.alpha));
  return {
    r: Math.round(parsed.rgb.r * alpha + over.r * (1 - alpha)),
    g: Math.round(parsed.rgb.g * alpha + over.g * (1 - alpha)),
    b: Math.round(parsed.rgb.b * alpha + over.b * (1 - alpha)),
  };
}

function parseColor(color: string | undefined): { rgb: Rgb; alpha: number } | null {
  const value = color?.trim().toLowerCase();
  if (!value) return null;
  const named = NAMED_BACKGROUNDS[value];
  if (named) return named;

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const pairs =
      hex.length <= 4
        ? [...hex].map((part) => Number.parseInt(part + part, 16))
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8)]
            .filter((part) => part.length > 0)
            .map((part) => Number.parseInt(part, 16));
    const [r = 0, g = 0, b = 0, a] = pairs;
    return { rgb: { r, g, b }, alpha: a === undefined ? 1 : a / 255 };
  }

  const body = /^rgba?\((.+)\)$/.exec(value)?.[1];
  if (!body) return null;
  const parts = (body.includes(',') ? body.split(',') : body.split(/[\s/]+/)).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(channel);
  if (channels.some((value) => value === null)) return null;
  const [r, g, b] = channels as number[];
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (r === undefined || g === undefined || b === undefined || alpha === null) return null;
  return { rgb: { r, g, b }, alpha };
}

function channel(part: string, scale = 255): number | null {
  const percent = part.endsWith('%');
  const value = Number.parseFloat(percent ? part.slice(0, -1) : part);
  if (!Number.isFinite(value)) return null;
  return percent ? (value / 100) * scale : value;
}

function contrastRatio(one: Rgb, other: Rgb): number {
  const lighter = Math.max(luminance(one), luminance(other));
  const darker = Math.min(luminance(one), luminance(other));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(rgb: Rgb): number {
  const linear = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
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
