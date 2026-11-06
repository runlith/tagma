import {
  formatHex,
  formatHex8,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeRgb,
  parse,
  toGamut,
  useMode,
  wcagContrast,
  type Oklch,
  type Rgb,
} from 'culori/fn';

useMode(modeLrgb);
useMode(modeOklab);
const toRgb = useMode(modeRgb);
const toOklch = useMode(modeOklch);
const intoSrgb = toGamut('rgb', 'oklch');

export const COLOUR_PATTERN = /^(?:#[0-9a-fA-F]{6}|oklch\(\s*(?:0|1|0?\.\d+|1\.0+)\s+(?:0|0?\.\d+|\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s*\))$/u;

export type Lch = { readonly l: number; readonly c: number; readonly h: number };

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/u;

const parsed = (value: string): Oklch => {
  const lch = OKLCH.exec(value);
  if (lch !== null) return { mode: 'oklch', l: Number(lch[1]), c: Number(lch[2]), h: Number(lch[3]) % 360 };
  const rgb: Rgb = {
    mode: 'rgb',
    r: Number.parseInt(value.slice(1, 3), 16) / 255,
    g: Number.parseInt(value.slice(3, 5), 16) / 255,
    b: Number.parseInt(value.slice(5, 7), 16) / 255,
  };
  return toOklch(rgb);
};

export const lchOf = (value: string): Lch => {
  const { l, c, h } = parsed(value);
  return { l, c, h: h ?? 0 };
};

export const hexOf = (value: string, alpha?: number): string => {
  const srgb = intoSrgb(parsed(value));
  return alpha === undefined ? formatHex(srgb) : formatHex8({ ...srgb, alpha });
};

export const contrastOf = (one: string, other: string): number =>
  wcagContrast(toRgb(intoSrgb(parsed(one))), toRgb(intoSrgb(parsed(other))));

const opaqueOver = (colour: string | undefined, ground: string): string | null => {
  const read = colour === undefined ? undefined : parse(colour.trim());
  if (read === undefined) return null;
  const top = toRgb(read);
  const under = toRgb(parsed(ground));
  const alpha = Math.min(1, Math.max(0, top.alpha ?? 1));
  const blend = (above: number, below: number): number => above * alpha + below * (1 - alpha);
  return formatHex(intoSrgb({ mode: 'rgb', r: blend(top.r, under.r), g: blend(top.g, under.g), b: blend(top.b, under.b) }));
};

const PLAIN_GROUND = { dark: '#0a0a0a', light: '#ffffff' } as const;

export const readsLight = (colour: string | undefined, over: keyof typeof PLAIN_GROUND): boolean => {
  const ground = opaqueOver(colour, PLAIN_GROUND[over]);
  return ground !== null && contrastOf('#000000', ground) >= contrastOf('#ffffff', ground);
};

const rounded = (value: number): string => String(Math.round(value * 10_000) / 10_000);

export const withAlpha = (value: string, alpha: number): string => {
  const { l, c, h } = lchOf(value);
  return `oklch(${rounded(l)} ${rounded(c)} ${rounded(h)} / ${alpha})`;
};

export const hueDistance = (one: number, other: number): number => {
  const apart = Math.abs(one - other) % 360;
  return apart > 180 ? 360 - apart : apart;
};
