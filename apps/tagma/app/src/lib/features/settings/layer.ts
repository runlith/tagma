import { Layer } from '@runlith/layer/Layer';
import { PaletteActions } from '$lib/features/workspace/action.js';
import { Columns } from '$lib/features/workspace/column.js';
import { actions } from './actions.js';
import { columns } from './columns.js';
import { SectionContributions, SettingSections } from './section.js';
import { SectionRegistry } from './SectionRegistry.js';
import { SettingsColumn } from './SettingsColumn.svelte.js';
import { SettingsRepo } from './SettingsRepo.js';

export const SettingsLayer = Layer.mergeAll(
  SettingSections,
  SectionContributions,
  SectionRegistry,
  Columns.contribute('settings', ...columns),
  PaletteActions.contribute('settings', { id: 'settings', actions }),
  SettingsRepo,
  SettingsColumn,
);
