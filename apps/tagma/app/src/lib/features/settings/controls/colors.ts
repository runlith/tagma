const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export type ColorRecord = Readonly<Record<string, string>>;

export function colorsOf(value: unknown): ColorRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const held: Record<string, string> = {};
  for (const [slot, colour] of Object.entries(value)) {
    if (typeof colour === 'string' && colour !== '') held[slot] = colour;
  }
  return held;
}

export function withColor(record: ColorRecord, slot: string, colour: string): ColorRecord {
  const trimmed = colour.trim();
  const { [slot]: dropped, ...rest } = record;
  return trimmed === '' ? rest : { ...rest, [slot]: trimmed };
}

export function isColor(colour: string): boolean {
  return HEX.test(colour.trim());
}

export function swatchOf(colour: string | undefined): string {
  return colour !== undefined && isColor(colour) ? colour : '';
}
