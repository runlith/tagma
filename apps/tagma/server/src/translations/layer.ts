import { Layer } from 'effect';
import { Translations } from './contract/service/translations.js';
import { makeTranslations } from './acts.js';
import { projectionsLayer } from './store/projections.js';

export const translationsLayer = Layer.effect(Translations, makeTranslations).pipe(Layer.provide(projectionsLayer));
