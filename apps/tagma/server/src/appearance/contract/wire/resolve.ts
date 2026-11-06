import { hexOf, withAlpha } from './colour.js';
import { ANSI_KEYS, type Palette, type ThemeMode, type ThemeVariant } from './format.js';
import { CHAT_TOKENS, ELEVATION_DARK, FIXED, HANDS, SPEAKERS, TAGMA, type Token } from './tagma.js';

export type TerminalPalette = { readonly [K in (typeof ANSI_KEYS)[number]]: string } & {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
};

type Resolved = {
  readonly mode: ThemeMode;
  readonly palette: Palette;
  readonly tokens: readonly Token[];
  readonly terminal: TerminalPalette;
  readonly chrome: string;
};

const ALPHAS = {
  light: { border: 0.12, input: 0.16, hover: 0.045, selected: 0.075, vein: 0.1, veinStrong: 0.24, ring: 0.55, danger: 0.08, brand: 0.14 },
  dark: { border: 0.1, input: 0.14, hover: 0.05, selected: 0.085, vein: 0.08, veinStrong: 0.2, ring: 0.6, danger: 0.14, brand: 0.16 },
} as const;

const SELECTION = { light: 0.25, dark: 0.3 } as const;

const WHITE = 'oklch(1 0 0)';

const merged = <T extends object>(base: T, over: Partial<T> | undefined): T => (over === undefined ? base : { ...base, ...over });

export const paletteOf = (variant: ThemeVariant | undefined, mode: ThemeMode): Palette => {
  const base = TAGMA[mode];
  if (variant === undefined) return base;
  return {
    surfaces: merged(base.surfaces, variant.surfaces),
    text: merged(base.text, variant.text),
    signals: merged(base.signals, variant.signals),
    syntax: merged(base.syntax, variant.syntax),
    marks: merged(base.marks, variant.marks),
    terminal: merged(base.terminal, variant.terminal),
  };
};

const tokensOf = ({ surfaces, text, signals, syntax, marks }: Palette, mode: ThemeMode): readonly Token[] => {
  const alpha = ALPHAS[mode];
  const ink = mode === 'light' ? text.foreground : WHITE;
  const elevation =
    mode === 'light'
      ? {
          raised: `0 2px 4px ${withAlpha(text.foreground, 0.05)}, 0 10px 24px ${withAlpha(text.foreground, 0.1)}`,
          float: `0 4px 10px ${withAlpha(text.foreground, 0.08)}, 0 18px 48px ${withAlpha(text.foreground, 0.16)}`,
        }
      : ELEVATION_DARK;
  return [
    ['--chrome', surfaces.chrome],
    ['--background', surfaces.background],
    ['--field', surfaces.field],
    ['--raised', surfaces.raised],
    ['--popover', surfaces.popover],
    ['--accent', surfaces.accent],
    ['--sunken', surfaces.sunken],
    ['--foreground', text.foreground],
    ['--popover-foreground', 'var(--foreground)'],
    ['--primary', text.primary],
    ['--primary-foreground', 'var(--background)'],
    ['--muted', surfaces.muted],
    ['--muted-foreground', text.muted],
    ['--accent-foreground', 'var(--primary)'],
    ['--destructive', signals.failure],
    ['--border', withAlpha(ink, alpha.border)],
    ['--input', withAlpha(ink, alpha.input)],
    ['--ring', withAlpha(signals.waiting, alpha.ring)],
    ['--hover', withAlpha(ink, alpha.hover)],
    ['--selected', withAlpha(ink, alpha.selected)],
    ['--hover-danger', withAlpha(signals.failure, alpha.danger)],
    ['--vein', withAlpha(ink, alpha.vein)],
    ['--vein-strong', withAlpha(ink, alpha.veinStrong)],
    ...FIXED[mode].before,
    ['--elevation-raised', elevation.raised],
    ['--elevation-float', elevation.float],
    ['--status-open', signals.waiting],
    ['--status-none', signals.neutral],
    ['--status-in-work', signals.work],
    ['--status-verified', 'var(--status-done)'],
    ['--status-stale', signals.stale],
    ['--status-done', signals.done],
    ['--status-closed', 'var(--status-none)'],
    ['--status-superseded', 'var(--status-none)'],
    ['--severity-lie', 'var(--destructive)'],
    ['--severity-gap', 'var(--status-in-work)'],
    ['--mutation', signals.change],
    ...HANDS[mode],
    ...CHAT_TOKENS,
    ['--brand', signals.here],
    ['--brand-soft', withAlpha(signals.here, alpha.brand)],
    ['--syntax-background', 'var(--sunken)'],
    ['--syntax-text', syntax.text],
    ['--syntax-declaration', syntax.declaration],
    ['--syntax-property', syntax.property],
    ['--syntax-punctuation', syntax.punctuation],
    ['--syntax-operator', syntax.operator],
    ['--syntax-comment', syntax.comment],
    ['--syntax-keyword', syntax.keyword],
    ['--syntax-string', syntax.string],
    ['--syntax-function', syntax.function],
    ['--syntax-type', syntax.type],
    ['--syntax-constant', syntax.constant],
    ['--syntax-tag', 'var(--syntax-function)'],
    ['--syntax-attribute', 'var(--syntax-type)'],
    ['--syntax-inserted', 'var(--status-done)'],
    ['--syntax-deleted', 'var(--severity-lie)'],
    ['--syntax-changed', 'var(--mutation)'],
    ...FIXED[mode].after,
    ...marks.worktree.map((value, at): Token => [`--worktree-${at}`, value]),
    ...marks.project.map((value, at): Token => [`--project-${at + 1}`, value]),
    ...SPEAKERS[mode],
  ];
};

const terminalOf = ({ surfaces, text, signals, terminal }: Palette, mode: ThemeMode): TerminalPalette => ({
  background: hexOf(surfaces.background),
  foreground: hexOf(text.foreground),
  cursor: hexOf(signals.here),
  cursorAccent: hexOf(surfaces.background),
  selectionBackground: hexOf(signals.here, SELECTION[mode]),
  ...(Object.fromEntries(ANSI_KEYS.map((key) => [key, hexOf(terminal[key])])) as { readonly [K in (typeof ANSI_KEYS)[number]]: string }),
});

export const resolve = (variant: ThemeVariant | undefined, mode: ThemeMode): Resolved => {
  const palette = paletteOf(variant, mode);
  return { mode, palette, tokens: tokensOf(palette, mode), terminal: terminalOf(palette, mode), chrome: hexOf(palette.surfaces.chrome) };
};

export const declarationsOf = (tokens: readonly Token[]): string => tokens.map(([name, value]) => `${name}:${value};`).join('');

export const blockOf = (selector: string, tokens: readonly Token[]): string =>
  `${selector} {\n${tokens.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`;
