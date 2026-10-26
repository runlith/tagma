import type { Adapter, Adapters } from '../adapter';
import type { LanguageId } from './index';
import { jsOf } from './js/index';
import { py } from './py/index';
import { svelte } from './svelte/index';

export const js = jsOf([svelte]);

export const scriptsOf = js.scripts;

const BY_LANGUAGE = { js, py } as const satisfies { readonly [K in LanguageId]: Adapter & { readonly id: K } };

export const ADAPTERS: Adapters = Object.values(BY_LANGUAGE);
