import { Schema } from 'effect';
import { AskChoice, SETTABLE_SCOPES, settingKey } from '../../../platform/contract/wire/setting.js';
import { LANGUAGE_TAG } from './language.js';

export const translationModel = settingKey({
  id: 'translation.model',
  order: 10,
  title: 'Translation model',
  description:
    '`{provider, model, reasoning}` that translates a block; it must answer text asks and offer the rung, a null rung taking the model’s default. Null: the light model of your default model’s provider, then your default model at its lowest rung, then the light model of the first connected provider. A model chosen in the translation lens wins for that act; a named model that cannot answer refuses.',
  schema: Schema.NullOr(AskChoice),
  control: { kind: 'ask', of: 'text' },
  fallback: null as AskChoice | null,
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

export const TRANSLATION_SETTING_KEYS = [translationModel, translationLanguage, translationInstructions] as const;

export const TRANSLATION_SETTING_SECTIONS = [
  {
    id: 'translation',
    order: 72,
    title: 'Translation',
    description: 'Which model translates a block into another language, into which language by default, and what every request asks of it.',
  },
] as const;
