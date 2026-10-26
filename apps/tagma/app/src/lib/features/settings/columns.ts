import type { ColumnsModule } from '$lib/features/workspace/column.js';
import { SettingsColumn } from './SettingsColumn.svelte.js';

export const columns: ColumnsModule['columns'] = [
  {
    id: 'settings',
    label: 'settings column',
    state: SettingsColumn,
    routes: ['/settings'],
    room: (app) => app.resolve(SettingsColumn).room,
  },
];
