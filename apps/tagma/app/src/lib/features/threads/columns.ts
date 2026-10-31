import type { ColumnDeclaration } from '$lib/features/workspace/column.js';
import { AgentsColumn } from './AgentsColumn.svelte.js';

export const columns: readonly ColumnDeclaration[] = [
  {
    id: 'agents',
    label: 'agents column',
    state: AgentsColumn,
    frame: () => import('./AgentsFrame.svelte'),
    stands: 'tile',
    search: true,
  },
];
