import type { PatchSpan } from '@runlith/utils/patch';

export type DiffToken = { readonly text: string; readonly color?: string };

export type DiffColours = ReadonlyMap<number, readonly DiffToken[]>;

export type DiffHighlight = (code: string, language: string | undefined, asker: string) => Promise<DiffColours | undefined>;

export type DiffPiece = { readonly text: string; readonly color?: string; readonly marked: boolean };

export function diffPieces(text: string, tokens: readonly DiffToken[] | undefined, spans: readonly PatchSpan[]): readonly DiffPiece[] {
  const pieces: DiffPiece[] = [];
  let at = 0;
  let next = 0;
  for (const token of tokens ?? [{ text }]) {
    const end = at + token.text.length;
    let cut = at;
    while (cut < end) {
      let span = spans[next];
      while (span !== undefined && span.end <= cut) {
        next += 1;
        span = spans[next];
      }
      const inside = span !== undefined && span.start <= cut;
      const until = span === undefined ? end : Math.min(inside ? span.end : span.start, end);
      pieces.push({
        text: token.text.slice(cut - at, until - at),
        color: token.color,
        marked: inside,
      });
      cut = until;
    }
    at = end;
  }
  return pieces;
}
