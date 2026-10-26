import type { Language } from '../language.js';
import { css } from './css.js';
import { hash } from './hash.js';
import { svelte } from './svelte.js';
import { typescript } from './typescript.js';

export const LANGUAGES: readonly Language[] = [typescript, css, hash, svelte];

export function languageOf(path: string, languages: readonly Language[] = LANGUAGES): Language | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(cut + 1);
  for (const language of languages) {
    for (const extension of language.extensions) {
      if (extension.startsWith('.') ? name.endsWith(extension) : name === extension) return language;
    }
  }
  return null;
}
