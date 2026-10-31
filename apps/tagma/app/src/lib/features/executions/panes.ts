import type { PaneKind } from '$lib/shared/panes/pane.js';
import { OUTPUT_TAB } from './commands/outputTab.js';
import OutputTabTitle from './commands/OutputTabTitle.svelte';
import { TERMINAL_PANE } from './kind.js';
import Offer from './terminal/Offer.svelte';
import TabTitle from './terminal/TabTitle.svelte';
import { Terminals } from './worktrees/Terminals.svelte.js';

export const panes: readonly PaneKind[] = [
  {
    kind: TERMINAL_PANE,
    noun: 'terminal',
    view: () => import('./terminal/TabView.svelte'),
    title: TabTitle,
    offer: { order: 20, view: Offer },
    close: (app, id) => id !== null && app.resolve(Terminals).requestClose(id),
    stands: (app, id, holder) => {
      if (id === null) return false;
      const terminals = app.resolve(Terminals);
      return terminals.ready ? terminals.worktreeOf(id)?.holderOf(id) === holder : null;
    },
  },
  {
    kind: OUTPUT_TAB,
    noun: 'terminal',
    view: () => import('./commands/OutputTab.svelte'),
    title: OutputTabTitle,
  },
];
