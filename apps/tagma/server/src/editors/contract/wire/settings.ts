import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';
import { EDITOR_IDS, EDITORS } from './catalog.js';

export const openIn = settingKey({
  id: 'editors.openIn',
  order: 870,
  title: 'Open files in',
  description:
    'The editor of this machine that "Open in" opens a file in. Picking another one from the menu makes it this choice; when it is not installed, the first installed editor opens.',
  schema: Schema.Literals(EDITOR_IDS),
  control: {
    kind: 'choice',
    choices: EDITORS.map((entry) => ({ value: entry.id, label: entry.name, hint: '' })),
  },
  fallback: 'vscode',
  scopes: ['user'],
  merge: 'replace',
});

export const EDITOR_SETTING_SECTIONS = [
  {
    id: 'editors',
    order: 128,
    title: 'Editors',
    description: 'Which editor of the machine the server runs on opens files from Tagma.',
  },
] as const;
