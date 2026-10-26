import { english } from './english.js';
import { russian } from './russian.js';

const CYRILLIC = /^\p{Script=Cyrillic}+$/u;
const LATIN = /^\p{Script=Latin}+$/u;

export function stem(word: string): string {
  if (CYRILLIC.test(word)) return russian(word);
  if (LATIN.test(word)) return english(word);
  return word;
}
