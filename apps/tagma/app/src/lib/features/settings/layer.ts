import { Layer } from '@runlith/layer/Layer';
import { Actions } from '$lib/features/workspace/action.js';
import { Columns } from '$lib/features/workspace/column.js';
import { actions } from './actions.js';
import { columns } from './columns.js';
import { SectionContributions, SettingSections } from './section.js';
import { SectionRegistry } from './SectionRegistry.js';
import { SettingsColumn } from './SettingsColumn.svelte.js';
import { SettingsRepo } from './SettingsRepo.js';
import { UserSettings } from './UserSettings.svelte.js';

export const SettingsLayer = Layer.mergeAll(
  UserSettings,
  SettingSections,
  SectionContributions,
  SectionRegistry,
  Columns.contribute('settings', ...columns),
  Actions.contribute('settings', { id: 'settings', area: 'Window', actions }),
  SettingsRepo,
  SettingsColumn,
);
