import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';

export const compactCount = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(count / 1000)}k`;
};

export type LineCountText =
  | { readonly kind: 'lines'; readonly added: string | null; readonly removed: string | null }
  | { readonly kind: 'binary' }
  | null;

export function lineCount(lines: CheckoutLines): LineCountText {
  if (lines === 'binary') return { kind: 'binary' };
  if (lines === 'unweighed') return null;
  if (lines.added === 0 && lines.removed === 0) return null;
  return {
    kind: 'lines',
    added: lines.added === 0 ? null : `+${compactCount(lines.added)}`,
    removed: lines.removed === 0 ? null : `−${compactCount(lines.removed)}`,
  };
}

export const sameLines = (one: CheckoutLines | undefined, other: CheckoutLines): boolean =>
  one === undefined
    ? false
    : typeof one === 'string' || typeof other === 'string'
      ? one === other
      : one.added === other.added && one.removed === other.removed;

export function sumLines(all: readonly CheckoutLines[]): CheckoutLines {
  let added = 0;
  let removed = 0;
  for (const lines of all) {
    if (typeof lines === 'string') continue;
    added += lines.added;
    removed += lines.removed;
  }
  return { added, removed };
}
