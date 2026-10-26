import type { FacetMemo, ParseMemo } from '@runlith/code-facts/blobs';

const PARSES_KEPT = 50_000;

export const parses: ParseMemo = new Map();
export const facets: FacetMemo = new Map();

export const trimParses = (imports: ParseMemo): void => {
  for (const memo of [imports, facets] as const) {
    for (const key of memo.keys()) {
      if (memo.size <= PARSES_KEPT) break;
      memo.delete(key);
    }
  }
};
