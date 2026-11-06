import { contrastOf, hueDistance, type Lch, lchOf } from './colour.js';
import { type Palette, SIGNAL_KEYS, type SignalKey, SURFACE_KEYS, SYNTAX_KEYS, TEXT_KEYS } from './format.js';

type Family = 'failure' | 'stale' | 'work' | 'here' | 'done' | 'blue';

const WINDOWS: readonly { readonly family: Family; readonly from: number; readonly to: number }[] = [
  { family: 'failure', from: 322, to: 31 },
  { family: 'stale', from: 31, to: 55 },
  { family: 'work', from: 55, to: 78 },
  { family: 'here', from: 78, to: 120 },
  { family: 'done', from: 120, to: 202 },
  { family: 'blue', from: 202, to: 322 },
];

const FAMILY: { readonly [K in Exclude<SignalKey, 'neutral'>]: Family } = {
  failure: 'failure',
  stale: 'stale',
  work: 'work',
  here: 'here',
  done: 'done',
  waiting: 'blue',
  change: 'blue',
};

const NAMED: { readonly [F in Family]: string } = {
  failure: 'failure',
  stale: 'stale',
  work: 'work',
  here: 'here',
  done: 'done',
  blue: 'waiting and change',
};

const SIGNAL_CHROMA = 0.08;
const NEUTRAL_CHROMA = 0.03;
const FAMILIES_APART = 15;
const HUED = 0.03;
const STANDS_OFF = 21;
const MARK_CHROMA = 0.08;
const SIGNAL_CONTRAST = 3;
const TEXT_CONTRAST = 4.5;
const AGAINST = ['background', 'chrome', 'raised', 'popover'] as const;
const QUIETEST = ['failure', 'work', 'done', 'waiting', 'change'] as const;

const within = (hue: number, from: number, to: number): boolean => (from <= to ? hue >= from && hue < to : hue >= from || hue < to);

const familyOf = (hue: number): Family => WINDOWS.find((window) => within(hue, window.from, window.to))!.family;

const degrees = (value: number): string => `${Math.round(value)}°`;

const HUED_SIGNALS = SIGNAL_KEYS.filter((key): key is Exclude<SignalKey, 'neutral'> => key !== 'neutral');

const signalsOf = (palette: Palette): readonly (readonly [Exclude<SignalKey, 'neutral'>, Lch])[] =>
  HUED_SIGNALS.map((key) => [key, lchOf(palette.signals[key])] as const);

const hueRefusal = (palette: Palette): string | null => {
  for (const [key, colour] of signalsOf(palette)) {
    const family = FAMILY[key];
    const window = WINDOWS.find((one) => one.family === family)!;
    const value = palette.signals[key];
    if (colour.c >= HUED && !within(colour.h, window.from, window.to))
      return `signals.${key} ${value} reads as ${NAMED[familyOf(colour.h)]}: its hue ${degrees(colour.h)} is outside ${NAMED[family]}'s ${window.from}°–${window.to}°`;
    if (colour.c < SIGNAL_CHROMA)
      return `signals.${key} ${value} is too grey to read as ${NAMED[family]}: its chroma ${colour.c.toFixed(3)} is under ${SIGNAL_CHROMA}`;
  }
  const neutral = lchOf(palette.signals.neutral);
  if (neutral.c > NEUTRAL_CHROMA)
    return `signals.neutral ${palette.signals.neutral} reads as a signal: its chroma ${neutral.c.toFixed(3)} is over ${NEUTRAL_CHROMA}`;
  return null;
};

const apartRefusal = (palette: Palette): string | null => {
  const signals = signalsOf(palette);
  for (const [at, [key, colour]] of signals.entries())
    for (const [other, against] of signals.slice(at + 1)) {
      if (FAMILY[key] === FAMILY[other]) continue;
      const apart = hueDistance(colour.h, against.h);
      if (apart < FAMILIES_APART)
        return `signals.${key} and signals.${other} stand ${degrees(apart)} apart, under the ${FAMILIES_APART}° that tells ${NAMED[FAMILY[key]]} from ${NAMED[FAMILY[other]]}`;
    }
  return null;
};

const contrastRefusal = (palette: Palette): string | null => {
  for (const key of SIGNAL_KEYS)
    for (const surface of AGAINST) {
      const ratio = contrastOf(palette.signals[key], palette.surfaces[surface]);
      if (ratio < SIGNAL_CONTRAST)
        return `signals.${key} ${palette.signals[key]} stands ${ratio.toFixed(2)}:1 on surfaces.${surface}, under ${SIGNAL_CONTRAST}:1`;
    }
  for (const key of ['foreground', 'muted'] as const)
    for (const surface of SURFACE_KEYS) {
      const ratio = contrastOf(palette.text[key], palette.surfaces[surface]);
      if (ratio < TEXT_CONTRAST)
        return `text.${key} ${palette.text[key]} reads ${ratio.toFixed(2)}:1 on surfaces.${surface}, under ${TEXT_CONTRAST}:1`;
    }
  return null;
};

const offSignals = (name: string, value: string, colour: Lch, signals: readonly (readonly [string, Lch])[]): string | null => {
  if (colour.c < HUED) return null;
  for (const [key, signal] of signals) {
    const apart = hueDistance(colour.h, signal.h);
    if (apart < STANDS_OFF)
      return `${name} ${value} stands ${degrees(apart)} from signals.${key}, under the ${STANDS_OFF}° that keeps it from reading as a signal`;
  }
  return null;
};

const syntaxRefusal = (palette: Palette): string | null => {
  const signals = signalsOf(palette);
  const ceiling = Math.min(...QUIETEST.map((key) => lchOf(palette.signals[key]).c));
  for (const key of SYNTAX_KEYS) {
    const value = palette.syntax[key];
    const colour = lchOf(value);
    const off = offSignals(`syntax.${key}`, value, colour, signals);
    if (off !== null) return off;
    if (colour.c >= ceiling)
      return `syntax.${key} ${value} is as strong as a signal: its chroma ${colour.c.toFixed(3)} reaches the quietest signal's ${ceiling.toFixed(3)}`;
  }
  return null;
};

const marksRefusal = (palette: Palette): string | null => {
  const signals = signalsOf(palette);
  const marks = [
    ...palette.marks.project.map((value, at) => [`marks.project[${at}]`, value] as const),
    ...palette.marks.worktree.map((value, at) => [`marks.worktree[${at}]`, value] as const),
  ];
  for (const [name, value] of marks) {
    const colour = lchOf(value);
    if (colour.c > MARK_CHROMA) return `${name} ${value} is too strong for a mark: its chroma ${colour.c.toFixed(3)} is over ${MARK_CHROMA}`;
    const off = offSignals(name, value, colour, signals);
    if (off !== null) return off;
  }
  return null;
};

const quietRefusal = (palette: Palette): string | null => {
  const ceiling = Math.min(...signalsOf(palette).map(([, colour]) => colour.c)) / 2;
  const quiet = [
    ...SURFACE_KEYS.map((key) => [`surfaces.${key}`, palette.surfaces[key]] as const),
    ...TEXT_KEYS.map((key) => [`text.${key}`, palette.text[key]] as const),
  ];
  for (const [name, value] of quiet) {
    const colour = lchOf(value);
    if (colour.c > ceiling)
      return `${name} ${value} is tinted like a signal: its chroma ${colour.c.toFixed(3)} is over ${ceiling.toFixed(3)}, half the weakest signal's`;
  }
  return null;
};

export const meaningRefusal = (palette: Palette): string | null =>
  hueRefusal(palette) ?? apartRefusal(palette) ?? contrastRefusal(palette) ?? syntaxRefusal(palette) ?? marksRefusal(palette) ?? quietRefusal(palette);
