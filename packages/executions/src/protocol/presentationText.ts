import type { ScreenAnswer, ScreenFrame, ScreenRow, ScreenTextFrame, ScreenTextRow, ScreenFeedItem } from './presentation';

export const screenRowText = (row: ScreenRow): string =>
  row.cells
    .map((cell) => (cell.chars === '' && cell.width > 0 ? ' ' : cell.chars))
    .join('')
    .replace(/\s+$/, '');

const textRow = (row: ScreenRow): ScreenTextRow => ({
  line: row.line,
  wrapped: row.wrapped,
  text: screenRowText(row),
});

export const screenLines = (frame: ScreenFrame | ScreenTextFrame): readonly string[] =>
  frame.rows.filter((row) => row.line >= frame.geometry.viewportLine).map((row) => ('text' in row ? row.text : screenRowText(row)));

export const screenTextFrame = (frame: ScreenFrame): ScreenTextFrame => ({
  _tag: 'ScreenTextFrame',
  provenance: frame.provenance,
  buffer: frame.buffer,
  geometry: frame.geometry,
  rows: frame.rows.map((row) => textRow(row)),
  cursor: frame.cursor,
  input: frame.input,
  title: frame.appearance.title,
});

export const screenAnswer = (update: ScreenFeedItem, cells: boolean): ScreenAnswer => {
  if (update._tag === 'ScreenFrame') return cells ? update : screenTextFrame(update);
  if (update._tag === 'ScreenUnavailable') return update;
  return {
    _tag: 'ScreenUnavailable',
    ref: update.provenance.ref,
    parsedThrough: update.provenance.parsedThrough,
    reason: 'engine',
    detail: `a point read answered ${update._tag}, which stands on a base no point read holds`,
  };
};
