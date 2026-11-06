import { Schema } from 'effect';
import { COLOUR_PATTERN } from './colour.js';

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const Colour = Schema.String.check(Schema.isPattern(COLOUR_PATTERN)).annotate({
  description: 'An opaque colour: #rrggbb, or oklch(L C H) with L from 0 to 1. Tagma derives every translucent value itself.',
});

const keyed = <const Keys extends readonly string[]>(keys: Keys, meanings: { readonly [K in Keys[number]]: string }) =>
  Schema.Struct(
    Object.fromEntries(keys.map((key) => [key, Schema.optionalKey(Colour.annotate({ description: meanings[key as Keys[number]] }))])) as {
      readonly [K in Keys[number]]: Schema.optionalKey<typeof Colour>;
    },
  );

export const SURFACE_KEYS = ['chrome', 'background', 'field', 'raised', 'popover', 'sunken', 'muted', 'accent'] as const;
export const TEXT_KEYS = ['foreground', 'muted', 'primary'] as const;
export const SIGNAL_KEYS = ['failure', 'stale', 'work', 'here', 'done', 'waiting', 'change', 'neutral'] as const;
export const SYNTAX_KEYS = [
  'text',
  'declaration',
  'property',
  'punctuation',
  'operator',
  'comment',
  'keyword',
  'string',
  'function',
  'type',
  'constant',
] as const;
export const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];

const PROJECT_MARKS = 8;
const WORKTREE_MARKS = 6;

const ANSI_MEANING = 'An ANSI colour programs pick in the terminal.';

const Surfaces = keyed(SURFACE_KEYS, {
  chrome: 'The window frame: the rail, the top bar and the status bar.',
  background: 'The feed and page ground.',
  field: 'Inputs and the composer.',
  raised: 'Cards and panels standing above the ground.',
  popover: 'Menus, popups and the palette.',
  sunken: 'Code blocks and wells below the ground.',
  muted: 'Quiet fills such as a skeleton or a track.',
  accent: 'A highlighted fill such as a pressed control.',
});

const Text = keyed(TEXT_KEYS, {
  foreground: 'Body text.',
  muted: 'Secondary text: hints, stamps and meta.',
  primary: 'The primary action’s fill and strong text.',
});

const Signals = keyed(SIGNAL_KEYS, {
  failure: 'Red: a failure, a refusal, a lie.',
  stale: 'Orange: stale, out of date.',
  work: 'Amber: in work, running.',
  here: 'Gold: you are here — the one current place.',
  done: 'Green: done, verified, added.',
  waiting: 'Blue: waiting on you, open.',
  change: 'Blue: a change, a write.',
  neutral: 'Grey: nothing to say, closed, superseded.',
});

const Syntax = keyed(SYNTAX_KEYS, {
  text: 'Plain code.',
  declaration: 'A name being declared.',
  property: 'A property or parameter.',
  punctuation: 'Brackets and separators.',
  operator: 'Operators.',
  comment: 'Comments.',
  keyword: 'Keywords.',
  string: 'Strings.',
  function: 'Function names and tags.',
  type: 'Types and attributes.',
  constant: 'Numbers and constants.',
});

const marks = (count: number, meaning: string) =>
  Schema.optionalKey(Schema.Array(Colour).check(Schema.isMinLength(count), Schema.isMaxLength(count)).annotate({ description: meaning }));

const Marks = Schema.Struct({
  project: marks(PROJECT_MARKS, 'The 8 project marks, quiet colours that tell projects apart.'),
  worktree: marks(WORKTREE_MARKS, 'The 6 worktree marks, quiet colours that tell worktrees apart.'),
});

const Terminal = keyed(
  ANSI_KEYS,
  Object.fromEntries(ANSI_KEYS.map((key) => [key, ANSI_MEANING])) as { readonly [K in (typeof ANSI_KEYS)[number]]: string },
);

export const ThemeVariant = Schema.Struct({
  surfaces: Schema.optionalKey(Surfaces),
  text: Schema.optionalKey(Text),
  signals: Schema.optionalKey(Signals),
  syntax: Schema.optionalKey(Syntax),
  marks: Schema.optionalKey(Marks),
  terminal: Schema.optionalKey(Terminal),
}).annotate({ description: 'What the theme changes in one look; every key it leaves out keeps Tagma’s value.' });
export type ThemeVariant = typeof ThemeVariant.Type;

const ThemeId = Schema.String.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u), Schema.isMaxLength(40)).annotate({
  description: 'The theme, named within its plugin: lowercase letters, digits and inner hyphens.',
});

export const Theme = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)).annotate({ description: 'What the theme picker calls it.' }),
  light: Schema.optionalKey(ThemeVariant),
  dark: Schema.optionalKey(ThemeVariant),
}).check(
  Schema.makeFilter((theme) => (theme.light !== undefined || theme.dark !== undefined ? true : 'a theme brings a light or a dark look')),
);
export type Theme = typeof Theme.Type;

export const ThemeEntries = Schema.Record(ThemeId, Theme);
export type ThemeEntries = typeof ThemeEntries.Type;

export const THEMES_POINT = 'themes';

export type Palette = {
  readonly surfaces: { readonly [K in (typeof SURFACE_KEYS)[number]]: string };
  readonly text: { readonly [K in (typeof TEXT_KEYS)[number]]: string };
  readonly signals: { readonly [K in SignalKey]: string };
  readonly syntax: { readonly [K in (typeof SYNTAX_KEYS)[number]]: string };
  readonly marks: { readonly project: readonly string[]; readonly worktree: readonly string[] };
  readonly terminal: { readonly [K in (typeof ANSI_KEYS)[number]]: string };
};

export const TAGMA_THEME = 'tagma';

export const themeIdOf = (plugin: string, theme: string): string => `${plugin}.${theme}`;

export const modeOf = (theme: Theme | undefined, wanted: ThemeMode): ThemeMode =>
  theme === undefined || theme[wanted] !== undefined ? wanted : wanted === 'light' ? 'dark' : 'light';
