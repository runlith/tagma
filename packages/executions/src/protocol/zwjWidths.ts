export const ZERO_WIDTH_JOINER = 0x200d;

export const ZWJ_VERSION = '11-zwj';

export type WidthTables = {
  wcwidth(codepoint: number): 0 | 1 | 2;
  charProperties(codepoint: number, preceding: number): number;
};

const widthOf = (properties: number): 0 | 1 | 2 => ((properties >> 1) & 3) as 0 | 1 | 2;
const kindOf = (properties: number): number => properties >> 3;
const pack = (charKind: number, cellWidth: 0 | 1 | 2, join: boolean): number =>
  ((charKind & 0xffffff) << 3) | ((cellWidth & 3) << 1) | (join ? 1 : 0);

export const zwjCharProperties = (base: WidthTables, codepoint: number, preceding: number): number => {
  const precedingWidth = widthOf(preceding);
  if (codepoint === ZERO_WIDTH_JOINER && precedingWidth > 0) return pack(ZERO_WIDTH_JOINER, precedingWidth, true);
  if (kindOf(preceding) === ZERO_WIDTH_JOINER && precedingWidth > 0 && base.wcwidth(codepoint) > 0) {
    return pack(codepoint, precedingWidth, true);
  }
  return base.charProperties(codepoint, preceding);
};

export const zwjProvider = (base: WidthTables) => ({
  version: ZWJ_VERSION,
  wcwidth: (codepoint: number) => base.wcwidth(codepoint),
  charProperties: (codepoint: number, preceding: number) => zwjCharProperties(base, codepoint, preceding),
});
