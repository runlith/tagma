import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey } from '../../../platform/contract/wire/setting.js';
import { LANGUAGE_TAG } from './language.js';

export const translationModel = settingKey({
  id: 'translation.model',
  order: 10,
  title: 'Translation model',
  description:
    'Provider and model that translates a block. Empty: the light model of the first connected provider that declares one. A model chosen in the translation lens wins for that act; a named model that cannot be resolved refuses.',
  schema: Schema.String,
  control: { kind: 'catalog', of: 'model' },
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const translationReasoning = settingKey({
  id: 'translation.reasoning',
  order: 20,
  title: 'Translation reasoning',
  description: 'Reasoning rung for translation: the named model must offer it; a model the chain chose takes it where offered.',
  schema: Schema.String,
  control: { kind: 'catalog', of: 'reasoning' },
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const translationLanguage = settingKey({
  id: 'translation.language',
  order: 30,
  title: 'Translation language',
  description:
    'The BCP 47 tag of the language a block is translated into with one press, such as `ru` or `pt-BR`. Empty: the last language translated into in this project, else the language of the system.',
  schema: Schema.Union([Schema.Literal(''), LANGUAGE_TAG]),
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const translationInstructions = settingKey({
  id: 'translation.instructions',
  order: 40,
  title: 'Translation instructions',
  description: 'Text added to every translation request: terms to keep untranslated, tone, how to address the reader.',
  schema: Schema.String,
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const TRANSLATION_SETTING_KEYS = [translationModel, translationReasoning, translationLanguage, translationInstructions] as const;

export const TRANSLATION_SETTING_SECTIONS = [
  {
    id: 'translation',
    order: 72,
    title: 'Translation',
    description: 'Which model translates a block into another language, into which language by default, and what every request asks of it.',
  },
] as const;
