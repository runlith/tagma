import type { PaneKind } from '$lib/shared/panes/pane.js';
import BlockHold from './BlockHold.svelte';
import BlockPaneTitle from './BlockPaneTitle.svelte';
import { BLOCK_PANE } from './blockPane.js';

export const panes: readonly PaneKind[] = [
  {
    kind: BLOCK_PANE,
    noun: 'block',
    portable: true,
    view: () => import('./BlockPane.svelte'),
    title: BlockPaneTitle,
    hold: BlockHold,
  },
];
