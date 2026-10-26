import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey } from '../../../platform/contract/wire/setting.js';

export const IMAGE_MODEL_AUTO = 'auto';
export const IMAGE_MODEL_OFF = 'off';

export const imageModelChoice = (provider: string, model: string): string => `${provider}/${model}`;

export const imageModel = settingKey({
  id: 'agent.images',
  order: 97,
  title: 'The model a thread draws pictures with',
  description:
    'The image model behind the picture tool of every agent, whatever model the thread runs on. `auto` takes the first image model of a provider you are signed in to, subscriptions before keys; `off` withdraws the tool. The choice takes effect when a run opens.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  control: { kind: 'catalog', of: 'image-model' },
  fallback: IMAGE_MODEL_AUTO,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});
