import { stem } from '@runlith/search-text/stem';
import { trigramForm } from '@runlith/search-text/trigram';
import { words } from '@runlith/search-text/words';

const SEARCH_TERM_MIN = 3;

function termOf(word: string): string {
  return trigramForm(stem(word));
}

function searchable(term: string): boolean {
  return [...term].length >= SEARCH_TERM_MIN;
}

export function searchTerms(text: string): string[] {
  return words(text).map(termOf).filter(searchable);
}

export function indexedWords(text: string): string[] {
  return [...new Set(words(text).filter((word) => searchable(termOf(word))))];
}

export function searchProjectionOf(title: string, body: string, sourceRefs: readonly string[]): { titleText: string; text: string } {
  const titleText = searchTerms(title).join(' ');
  const rest = searchTerms([body, ...sourceRefs].join(' ')).join(' ');
  return { titleText, text: rest ? `${titleText} ${rest}` : titleText };
}

export type SearchSubject = {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly sourceRefs: readonly string[];
};

export type SearchRow = { readonly blockId: number; readonly titleText: string; readonly text: string };

export const searchRowsOf = (subjects: readonly SearchSubject[]): SearchRow[] =>
  subjects.map((subject) => ({ blockId: subject.id, ...searchProjectionOf(subject.title, subject.body, subject.sourceRefs) }));
