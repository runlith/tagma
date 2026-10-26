import { stemsOf } from './highlight.js';
import { distance, typos } from './match.js';
import { stem } from './stem.js';
import { trigramForm } from './trigram.js';
import { normalize, words } from './words.js';

const TRIGRAM = 3;

export const BUCKET = 2 ** 21;
const EARLIEST = -(2 ** 42);
const LATEST = 2 ** 42;

export const keyable = (ms: number): boolean => Number.isInteger(ms) && ms >= EARLIEST && ms < LATEST;

export type QueryTerms = {
  readonly matched: readonly string[];
  readonly short: readonly string[];
  readonly stems: readonly string[];
};

export function projectionOf(text: string): string {
  const added: string[] = [];
  for (const word of words(text)) {
    const root = stem(word);
    if (!word.includes(root)) added.push(root);
  }
  const normalized = normalize(text);
  return trigramForm(added.length === 0 ? normalized : `${normalized} ${added.join(' ')}`);
}

export function termsOf(query: string): QueryTerms {
  const stems = stemsOf(query);
  const terms = [...new Set(stems.map(trigramForm))];
  return {
    matched: terms.filter((term) => [...term].length >= TRIGRAM),
    short: terms.filter((term) => [...term].length < TRIGRAM),
    stems,
  };
}

const quoted = (term: string): string => `"${term.replaceAll('"', '""')}"`;

export function matchExpression(terms: readonly (string | readonly string[])[]): string {
  return terms.map((term) => (typeof term === 'string' ? quoted(term) : `(${term.map(quoted).join(' OR ')})`)).join(' AND ');
}

type Fixed = { readonly term: string; readonly root: string };

export type NearQuery = {
  readonly expression: string;
  readonly loose: readonly string[];
  readonly fixed: readonly Fixed[];
};

export type Spelling = {
  readonly terms: readonly (readonly string[])[];
  readonly stems: readonly string[];
};

const RUN = /[\p{L}\p{M}\p{N}]+/gu;
const WHOLE_RUN = /^[\p{L}\p{M}\p{N}]+$/u;
//! The texts spellings are read from: a bound by construction, so reading them costs a few milliseconds on the loop whatever the corpus holds.
export const SPELLING_SAMPLE = { rows: 256, chars: 768 } as const;
//! A word answers its few nearest spellings, the most frequent first: enough for its inflections and for the one its other words stand beside, few enough that the strict query stays precise.
const SPELLINGS = 8;

function trigramsOf(chars: readonly string[], into: Set<string>): void {
  for (let at = 0; at + TRIGRAM <= chars.length; at += 1) into.add(chars.slice(at, at + TRIGRAM).join(''));
}

function trigramsNear(word: string): readonly string[] {
  const chars = [...word];
  const found = new Set<string>();
  trigramsOf(chars, found);
  for (let at = 0; at + 1 < chars.length; at += 1) {
    if (chars[at] === chars[at + 1]) continue;
    const around = chars.slice(Math.max(0, at - 2), at + 4);
    const swap = Math.min(at, 2);
    [around[swap], around[swap + 1]] = [chars[at + 1] as string, chars[at] as string];
    trigramsOf(around, found);
  }
  return [...found];
}

export function nearQuery(query: string): NearQuery | null {
  const groups: (string | readonly string[])[] = [];
  const loose: string[] = [];
  const fixed: Fixed[] = [];
  for (const word of new Set(words(query))) {
    const root = stem(word);
    const term = trigramForm(root);
    if (term === root && typos(word.length) > 0 && WHOLE_RUN.test(word)) {
      loose.push(word);
      groups.push(trigramsNear(word));
    } else if ([...term].length >= TRIGRAM) {
      fixed.push({ term, root });
      groups.push(term);
    }
  }
  return loose.length === 0 ? null : { expression: matchExpression(groups), loose, fixed };
}

function searchable(word: string): string {
  const root = stem(word);
  return trigramForm([...root].length >= TRIGRAM ? root : word);
}

export function spellingsOf(query: NearQuery, texts: Iterable<string>): Spelling | null {
  const seen = new Map<string, number>();
  for (const text of texts) {
    for (const [word] of normalize(text).matchAll(RUN)) seen.set(word, (seen.get(word) ?? 0) + 1);
  }
  const terms: string[][] = [];
  const stems: string[] = [];
  for (const needle of query.loose) {
    const limit = typos(needle.length);
    const near: { readonly word: string; readonly apart: number; readonly count: number }[] = [];
    for (const [word, count] of seen) {
      if (typos(word.length) === 0) continue;
      const apart = distance(needle, word, limit);
      if (apart !== null) near.push({ word, apart, count });
    }
    if (near.length === 0) return null;
    const spelled = near
      .sort((left, right) => left.apart - right.apart || right.count - left.count)
      .slice(0, SPELLINGS)
      .map((one) => one.word);
    terms.push([...new Set(spelled.map(searchable))]);
    stems.push(...new Set(spelled.map(stem)));
  }
  for (const one of query.fixed) {
    terms.push([one.term]);
    stems.push(one.root);
  }
  return { terms, stems };
}
