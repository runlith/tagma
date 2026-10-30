import type { ColumnsModule } from '$lib/features/workspace/column.js';
import { PluginsColumn } from './PluginsColumn.svelte.js';

export const columns: ColumnsModule['columns'] = [
  { id: 'plugins', label: 'plugins column', state: PluginsColumn, frame: () => import('./PlaceList.svelte') },
];
