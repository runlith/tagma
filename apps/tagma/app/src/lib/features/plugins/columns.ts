import type { ColumnDeclaration } from '$lib/features/workspace/column.js';
import { PluginsColumn } from './PluginsColumn.svelte.js';

export const columns: readonly ColumnDeclaration[] = [
  { id: 'plugins', label: 'plugins column', state: PluginsColumn, frame: () => import('./PlaceList.svelte') },
];
