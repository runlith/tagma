import type { Palette, ThemeMode } from './format.js';

const mark = (l: number, c: number, h: number): string => `oklch(${l} ${c} ${h})`;

const LIGHT: Palette = {
  surfaces: {
    chrome: 'oklch(0.965 0.004 252)',
    background: 'oklch(0.985 0.002 252)',
    field: 'oklch(1 0 0)',
    raised: 'oklch(1 0 0)',
    popover: 'oklch(1 0 0)',
    sunken: 'oklch(0.955 0.005 254)',
    muted: 'oklch(0.952 0.005 252)',
    accent: 'oklch(0.945 0.006 252)',
  },
  text: {
    foreground: 'oklch(0.22 0.015 260)',
    muted: 'oklch(0.515 0.018 258)',
    primary: 'oklch(0.28 0.018 260)',
  },
  signals: {
    failure: 'oklch(0.49 0.21 20)',
    stale: 'oklch(0.52 0.18 42)',
    work: 'oklch(0.515 0.15 68)',
    here: 'oklch(0.58 0.105 88)',
    done: 'oklch(0.48 0.14 152)',
    waiting: 'oklch(0.47 0.19 264)',
    change: 'oklch(0.53 0.17 252)',
    neutral: 'oklch(0.5 0.016 258)',
  },
  syntax: {
    text: 'oklch(0.27 0.012 260)',
    declaration: 'oklch(0.2 0.015 260)',
    property: 'oklch(0.36 0.012 260)',
    punctuation: 'oklch(0.56 0.012 260)',
    operator: 'oklch(0.5 0.012 260)',
    comment: 'oklch(0.53 0.012 258)',
    keyword: 'oklch(0.5 0.13 300)',
    string: 'oklch(0.5 0.085 182)',
    function: 'oklch(0.49 0.09 215)',
    type: 'oklch(0.5 0.12 335)',
    constant: 'oklch(0.5 0.12 335)',
  },
  marks: {
    project: [285, 185, 350, 120, 230, 315, 80, 210].map((hue) => mark(0.55, hue === 80 ? 0.015 : 0.07, hue)),
    worktree: [295, 180, 120, 225, 355, 325].map((hue) => mark(0.55, 0.07, hue)),
  },
  terminal: {
    black: '#2e3436',
    red: '#cc0000',
    green: '#4e9a06',
    yellow: '#8e7700',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#05727e',
    white: '#6a6a6a',
    brightBlack: '#555753',
    brightRed: '#ef2929',
    brightGreen: '#1b7a1b',
    brightYellow: '#6d5a00',
    brightBlue: '#204a87',
    brightMagenta: '#ad7fa8',
    brightCyan: '#034b50',
    brightWhite: '#3d3d3d',
  },
};

const DARK: Palette = {
  surfaces: {
    chrome: 'oklch(0.105 0 0)',
    background: 'oklch(0.14 0 0)',
    field: 'oklch(0.16 0 0)',
    raised: 'oklch(0.2 0 0)',
    popover: 'oklch(0.16 0 0)',
    sunken: 'oklch(0.09 0 0)',
    muted: 'oklch(0.21 0 0)',
    accent: 'oklch(0.22 0 0)',
  },
  text: {
    foreground: 'oklch(0.94 0 0)',
    muted: 'oklch(0.63 0 0)',
    primary: 'oklch(0.94 0 0)',
  },
  signals: {
    failure: 'oklch(0.7 0.19 20)',
    stale: 'oklch(0.73 0.16 42)',
    work: 'oklch(0.78 0.14 68)',
    here: 'oklch(0.755 0.105 88)',
    done: 'oklch(0.74 0.14 152)',
    waiting: 'oklch(0.72 0.14 264)',
    change: 'oklch(0.74 0.15 252)',
    neutral: 'oklch(0.61 0 0)',
  },
  syntax: {
    text: 'oklch(0.9 0 0)',
    declaration: 'oklch(0.95 0 0)',
    property: 'oklch(0.84 0 0)',
    punctuation: 'oklch(0.6 0 0)',
    operator: 'oklch(0.66 0 0)',
    comment: 'oklch(0.58 0 0)',
    keyword: 'oklch(0.76 0.085 300)',
    string: 'oklch(0.8 0.07 182)',
    function: 'oklch(0.82 0.065 212)',
    type: 'oklch(0.78 0.075 332)',
    constant: 'oklch(0.78 0.075 332)',
  },
  marks: {
    project: [285, 185, 350, 120, 230, 315, 80, 210].map((hue) => mark(0.74, hue === 80 ? 0.015 : 0.06, hue)),
    worktree: [295, 180, 120, 225, 355, 325].map((hue) => mark(0.74, 0.06, hue)),
  },
  terminal: {
    black: '#1d1f21',
    red: '#cc6666',
    green: '#b5bd68',
    yellow: '#f0c674',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#c5c8c6',
    brightBlack: '#666666',
    brightRed: '#d54e53',
    brightGreen: '#b9ca4a',
    brightYellow: '#e7c547',
    brightBlue: '#7aa6da',
    brightMagenta: '#c397d8',
    brightCyan: '#70c0b1',
    brightWhite: '#eaeaea',
  },
};

export const TAGMA: { readonly [M in ThemeMode]: Palette } = { light: LIGHT, dark: DARK };

const CHAT = [
  ['--chat-raised', 'var(--raised)'],
  ['--chat-sunken', 'var(--sunken)'],
  ['--chat-chrome', 'var(--chrome)'],
  ['--chat-field', 'var(--field)'],
  ['--chat-live', 'var(--status-in-work)'],
  ['--chat-live-mark', 'var(--status-in-work)'],
  ['--chat-here', 'var(--brand)'],
  ['--chat-aim', 'var(--status-open)'],
  ['--chat-success', 'var(--status-done)'],
  ['--chat-success-mark', 'var(--status-done)'],
  ['--chat-success-label', 'var(--status-done)'],
  ['--chat-failure', 'var(--severity-lie)'],
  ['--chat-refused', 'var(--severity-lie)'],
  ['--chat-mutation', 'var(--mutation)'],
  ['--chat-diff-added', 'var(--status-done)'],
  ['--chat-diff-removed', 'var(--severity-lie)'],
  ['--chat-guidance', 'var(--status-open)'],
  ['--chat-queued', 'var(--status-open)'],
  ['--chat-queued-label', 'var(--status-open)'],
  ['--chat-interrupted', 'var(--status-in-work)'],
  ['--chat-interrupted-label', 'var(--status-in-work)'],
  ['--chat-waiting', 'var(--status-open)'],
  ['--chat-context-track', 'var(--vein-strong)'],
  ['--chat-scrim', 'oklch(0 0 0 / 0.8)'],
] as const;

const WINDOW = [
  ['--window-close', '#ff5f57'],
  ['--window-minimize', '#febc2e'],
  ['--window-zoom', '#28c840'],
  ['--window-light-edge', 'oklch(0 0 0 / 0.12)'],
] as const;

const INKS = [
  ['--ink-on-dark', 'oklch(1 0 0)'],
  ['--ink-on-light', 'oklch(0.21 0.006 286)'],
  ['--scrim', 'oklch(0 0 0 / 0.1)'],
] as const;

export type Token = readonly [name: string, value: string];

export const FIXED: { readonly [M in ThemeMode]: { readonly before: readonly Token[]; readonly after: readonly Token[] } } = {
  light: {
    before: INKS,
    after: [
      ...WINDOW,
      ['--tag-module', 'oklch(0.58 0.15 300)'],
      ['--tag-spec', 'oklch(0.56 0.16 245)'],
      ['--tag-task', 'oklch(0.56 0.1 195)'],
      ['--tag-rule', 'oklch(0.57 0.18 345)'],
      ['--tag-idea', 'oklch(0.62 0.13 105)'],
    ],
  },
  dark: {
    before: INKS,
    after: [
      ...WINDOW,
      ['--tag-module', 'oklch(0.74 0.14 300)'],
      ['--tag-spec', 'oklch(0.72 0.14 245)'],
      ['--tag-task', 'oklch(0.76 0.1 195)'],
      ['--tag-rule', 'oklch(0.73 0.15 345)'],
      ['--tag-idea', 'oklch(0.8 0.12 105)'],
    ],
  },
};

export const HANDS: { readonly [M in ThemeMode]: readonly Token[] } = {
  light: [
    ['--hand-1', 'oklch(0.54 0.19 300)'],
    ['--hand-2', 'oklch(0.55 0.12 195)'],
    ['--hand-3', 'oklch(0.55 0.2 350)'],
    ['--hand-4', 'oklch(0.52 0.16 275)'],
  ],
  dark: [
    ['--hand-1', 'oklch(0.75 0.16 300)'],
    ['--hand-2', 'oklch(0.76 0.11 195)'],
    ['--hand-3', 'oklch(0.74 0.17 350)'],
    ['--hand-4', 'oklch(0.73 0.14 275)'],
  ],
};

export const SPEAKERS: { readonly [M in ThemeMode]: readonly Token[] } = {
  light: [
    ['--speaker-1', 'oklch(0.55 0.15 250)'],
    ['--speaker-2', 'oklch(0.58 0.15 40)'],
    ['--speaker-3', 'oklch(0.55 0.13 160)'],
    ['--speaker-4', 'oklch(0.56 0.17 330)'],
    ['--speaker-5', 'oklch(0.6 0.13 95)'],
    ['--speaker-6', 'oklch(0.55 0.13 285)'],
  ],
  dark: [
    ['--speaker-1', 'oklch(0.74 0.12 250)'],
    ['--speaker-2', 'oklch(0.77 0.13 40)'],
    ['--speaker-3', 'oklch(0.76 0.12 160)'],
    ['--speaker-4', 'oklch(0.74 0.14 330)'],
    ['--speaker-5', 'oklch(0.8 0.12 95)'],
    ['--speaker-6', 'oklch(0.74 0.12 285)'],
  ],
};

export const ELEVATION_DARK = {
  raised: 'inset 0 1px 0 oklch(1 0 0 / 0.04), 0 2px 4px oklch(0 0 0 / 0.3), 0 12px 28px oklch(0 0 0 / 0.45)',
  float: 'inset 0 1px 0 oklch(1 0 0 / 0.04), 0 6px 14px oklch(0 0 0 / 0.42), 0 22px 56px oklch(0 0 0 / 0.55)',
} as const;

export const CHAT_TOKENS: readonly Token[] = CHAT;
