import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

export const AUTO_SAVE_MODES = ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const;
export type AutoSaveMode = (typeof AUTO_SAVE_MODES)[number];

export const DEFAULT_AUTO_SAVE_MODE: AutoSaveMode = 'off';

export const DEFAULT_AUTO_SAVE_DELAY_MS = 1000;

export const MIN_AUTO_SAVE_DELAY_MS = 100;

export const autoSave = settingKey({
  id: 'editor.autoSave',
  order: 860,
  title: 'Auto save',
  description: 'When an edit of an open file is written to the disk. Cmd+S writes at once in every mode.',
  schema: Schema.Literals(AUTO_SAVE_MODES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'off', label: 'Off', hint: 'Only on Cmd+S. Closing a tab with unsaved edits asks first.' },
      {
        value: 'afterDelay',
        label: 'After a delay',
        hint: 'Written after the delay below, and at once when the editor loses focus, the tab changes or closes, or the window is hidden.',
      },
      { value: 'onFocusChange', label: 'On focus change', hint: 'Written when the editor loses focus, the tab changes or closes.' },
      { value: 'onWindowChange', label: 'On window change', hint: 'Written when the window loses focus.' },
    ],
  },
  fallback: DEFAULT_AUTO_SAVE_MODE,
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const autoSaveDelay = settingKey({
  id: 'editor.autoSaveDelay',
  order: 865,
  title: 'Auto save delay',
  description: 'How long after the last edit the file is written when auto save is after a delay.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_AUTO_SAVE_DELAY_MS)),
  control: { kind: 'number', minimum: MIN_AUTO_SAVE_DELAY_MS, step: 100, unit: 'milliseconds' },
  fallback: DEFAULT_AUTO_SAVE_DELAY_MS,
  scopes: ['user', 'project'],
  merge: 'replace',
});

export const FILES_SETTING_KEYS = [autoSave, autoSaveDelay] as const;

export const FILES_SETTING_SECTIONS = [
  {
    id: 'editor',
    order: 127,
    title: 'Editor',
    description: 'How the files of a checkout are edited and written.',
  },
] as const;
