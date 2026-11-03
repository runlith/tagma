import { Schema } from 'effect';
import { place } from './fields.js';

export const SOURCE_KINDS = ['file', 'dir', 'symbol'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const FILE_KINDS = ['file', 'symbol'] as const satisfies readonly SourceKind[];

export const TERRITORY_KINDS = ['dir', 'file'] as const satisfies readonly SourceKind[];

export function isTerritoryKind(kind: SourceKind): boolean {
  return (TERRITORY_KINDS as readonly string[]).includes(kind);
}

export const anchorsOf = (rows: readonly { readonly kind: string; readonly ref: string; readonly symbol: string | null }[]): string[] =>
  rows.map((row) => JSON.stringify([row.kind, row.ref, row.symbol])).sort();

export const sourceInputSchema = Schema.Struct({
  kind: Schema.Literals(SOURCE_KINDS),
  ref: place,
  symbol: Schema.optional(place),
});
export type SourceInput = typeof sourceInputSchema.Type;

export function sourceName(ref: string, symbol: string | null): string {
  return symbol === null ? ref : `${ref}#${symbol}`;
}

export function sourceSpelling(spelling: string): { ref: string; symbol?: string; dir?: true } {
  const separator = spelling.indexOf('#');
  if (separator !== -1) {
    return { ref: spelling.slice(0, separator), symbol: spelling.slice(separator + 1) };
  }
  const bare = spelling.replace(/\/+$/, '');
  return spelling.endsWith('/') && bare.length > 0 ? { ref: bare, dir: true } : { ref: spelling };
}
