import { Schema } from 'effect';
import { settingKey, SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';

export const navigationEnabled = settingKey({
  id: 'navigation.enabled',
  order: 840,
  title: 'Code navigation',
  description: 'Offer definition and uses to agents and run navigation engines for this project. Switching it off stops its engines.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const NAVIGATION_SETTING_SECTIONS = [
  { id: 'navigation', order: 63, title: 'Code navigation', description: 'Symbol declarations and uses, backed by language engines.' },
] as const;
