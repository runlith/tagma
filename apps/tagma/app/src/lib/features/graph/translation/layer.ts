import { Layer } from '@runlith/layer/Layer';
import { TranslationsRepo } from './Repo.js';
import { Translations } from './Translations.svelte.js';

export const TranslationLayer = Layer.mergeAll(TranslationsRepo, Translations);
