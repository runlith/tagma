import type { PanesModule } from '$lib/shared/panes/pane.js';
import BlockHold from './BlockHold.svelte';
import BlockPaneTitle from './BlockPaneTitle.svelte';
import { BLOCK_PANE } from './blockPane.js';

export const panes: PanesModule['panes'] = [
  {
    kind: BLOCK_PANE,
    noun: 'block',
    portable: true,
    view: () => import('./BlockPane.svelte'),
    title: BlockPaneTitle,
    hold: BlockHold,
  },
];
