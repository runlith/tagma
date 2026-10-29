import { createHash } from 'node:crypto';
import { Lexer } from 'marked';
import { mask, type Masked } from './masks.js';

export type PartKind = 'title' | 'text' | 'kept';

export type Part = {
  readonly kind: PartKind;
  readonly source: string;
  readonly hash: string;
  readonly masked: Masked | null;
};

export type Segmented = { readonly title: string; readonly body: string };

const KEPT = new Set(['code', 'html', 'hr', 'def']);

const hashOf = (kind: PartKind, source: string): string => createHash('sha256').update(`${kind}\n${source}`).digest('hex').slice(0, 32);

const part = (kind: PartKind, source: string): Part => ({
  kind,
  source,
  hash: hashOf(kind, source),
  masked: kind === 'kept' ? null : mask(source),
});

export const titleHash = (title: string): string => hashOf('title', title);

export const partsOf = ({ title, body }: Segmented): readonly Part[] => [
  part('title', title),
  ...Lexer.lex(body, { gfm: true })
    .filter((token) => token.type !== 'space')
    .map((token) => part(KEPT.has(token.type) ? 'kept' : 'text', token.raw.replace(/\n+$/u, '')))
    .filter((one) => one.source.trim() !== ''),
];
