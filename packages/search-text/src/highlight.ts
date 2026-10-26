import { stem } from './stem.js';
import { normalize, words } from './words.js';

export type Span = { readonly start: number; readonly end: number };

export type Snippet = { readonly snippet: string; readonly highlights: readonly Span[] };

const TOKEN = /[\p{L}\p{M}\p{N}_./#-]+/gu;

export function stemsOf(query: string): readonly string[] {
  return [...new Set(words(query).map(stem))];
}

export function snippetOf(text: string, stems: readonly string[], width: number): Snippet {
  const spans: Span[] = [];
  for (const found of text.matchAll(TOKEN)) {
    const token = found[0];
    const normalized = normalize(token);
    const root = stem(normalized);
    for (const term of stems) {
      const inside = normalized.indexOf(term);
      if (inside >= 0 && normalized.length === token.length) {
        spans.push({ start: found.index + inside, end: found.index + inside + term.length });
        break;
      }
      if (inside >= 0 || root === term) {
        spans.push({ start: found.index, end: found.index + token.length });
        break;
      }
    }
  }
  const first = spans[0]?.start ?? 0;
  const from = text.length <= width ? 0 : Math.max(0, Math.min(first - width / 3, text.length - width));
  const start = Math.floor(from);
  const end = Math.min(text.length, start + width);
  return {
    snippet: text.slice(start, end),
    highlights: spans
      .filter((span) => span.start >= start && span.end <= end)
      .map((span) => ({ start: span.start - start, end: span.end - start })),
  };
}
