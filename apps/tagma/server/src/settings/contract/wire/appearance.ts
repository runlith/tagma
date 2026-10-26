import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

export const APPEARANCE_SETTING_SECTIONS = [
  {
    id: 'appearance',
    order: 20,
    title: 'Appearance',
    description: 'What the Tagma surface shows around the work: the status bar and its segments.',
  },
] as const;

export const loadInStatusBar = settingKey({
  id: 'appearance.loadInStatusBar',
  order: 10,
  title: 'Load in the status bar',
  description:
    'Whether the status bar shows the machine load button. The load is still read for the thread badges, and a badge still opens it, when the button is hidden.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: ['user'],
  merge: 'replace',
});
