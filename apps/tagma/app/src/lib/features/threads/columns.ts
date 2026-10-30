import type { ColumnsModule } from '$lib/features/workspace/column.js';
import { AgentsColumn } from './AgentsColumn.svelte.js';

export const columns: ColumnsModule['columns'] = [
  {
    id: 'agents',
    label: 'agents column',
    state: AgentsColumn,
    frame: () => import('./AgentsFrame.svelte'),
    stands: 'tile',
    search: true,
  },
];
