import type { ColumnDeclaration } from '$lib/features/workspace/column.js';
import { Sidebar } from './sidebar/Sidebar.svelte.js';

export const columns: readonly ColumnDeclaration[] = [
  { id: 'knowledge', label: 'knowledge column', state: Sidebar, frame: () => import('./sidebar/Sidebar.svelte') },
];
