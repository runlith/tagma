import { Schema } from 'effect';
import { AskChoice, settingKey } from '../../../platform/contract/wire/setting.js';

export const askModel = settingKey({
  id: 'ask.model',
  order: 10,
  title: 'Model for asks from outside',
  description:
    '`{provider, model, reasoning}` that answers a plugin’s `ask_model` call when the plugin names no model; it must answer text asks and offer the rung, a null rung taking the model’s default. Null: the light model of your default model’s provider, then your default model at its lowest rung, then the light model of the first connected provider. A model the plugin names wins for that call; a named model that cannot answer refuses.',
  schema: Schema.NullOr(AskChoice),
  control: { kind: 'ask', of: 'text' },
  fallback: null as AskChoice | null,
  scopes: ['user'],
  merge: 'replace',
});

export const PROVIDER_SETTING_KEYS = [askModel] as const;

export const PROVIDER_SETTING_SECTIONS = [
  {
    id: 'ask',
    order: 73,
    title: 'Asks',
    description: 'Which of your models answers a question a plugin puts to a model once, on your accounts.',
  },
] as const;
