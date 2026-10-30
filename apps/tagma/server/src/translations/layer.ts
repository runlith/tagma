import { Layer } from 'effect';
import { askSetting, modelsNamed } from '../providers/askSettings.js';
import { Translations } from './contract/service/translations.js';
import { translationModel } from './contract/wire/settings.js';
import { makeTranslations } from './acts.js';
import { projectionsLayer } from './store/projections.js';

export const translationsLayer = Layer.merge(
  Layer.effect(Translations, makeTranslations).pipe(Layer.provide(projectionsLayer)),
  Layer.effectDiscard(askSetting(translationModel, 'text', modelsNamed)),
);
