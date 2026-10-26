import type { Language } from '../adapter';
import { language as js } from './js/language';
import { language as py } from './py/language';
import { language as svelte } from './svelte/language';

export const LANGUAGES = [{ id: js.id, extensions: [...js.extensions, ...svelte.extensions] }, py] as const satisfies readonly Language[];

export type LanguageId = (typeof LANGUAGES)[number]['id'];
