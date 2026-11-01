import { projectScopedOf, type PaneKind } from '$lib/shared/panes/pane.js';
import { OUTPUT_TAB } from './commands/outputTab.js';
import OutputTabTitle from './commands/OutputTabTitle.svelte';
import { TERMINAL_PANE, terminalPaneOf } from './kind.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import TabHold from './terminal/TabHold.svelte';
import { TerminalTabs } from './terminal/Tabs.svelte.js';
import Offer from './terminal/Offer.svelte';
import TabTitle from './terminal/TabTitle.svelte';

export const panes: readonly PaneKind[] = [
  {
    kind: TERMINAL_PANE,
    noun: 'terminal',
    portable: true,
    hold: TabHold,
    view: () => import('./terminal/TabView.svelte'),
    title: TabTitle,
    offer: { order: 20, view: Offer },
    close: (app, id) => {
      const place = terminalPaneOf(id, app.resolve(ProjectRung.Current).projectId);
      if (place === null) return false;
      const terminals = app.resolve(TerminalTabs).of(place.projectId);
      return terminals?.requestClose(place.key) ?? false;
    },
    stands: (app, id, holder) => {
      const place = terminalPaneOf(id, app.resolve(ProjectRung.Current).projectId);
      if (place === null) return false;
      const terminals = app.resolve(TerminalTabs).of(place.projectId);
      if (!terminals?.ready) return null;
      const owner = terminals.worktreeOf(place.key)?.ownerOf(place.key);
      return projectScopedOf(id) !== null && owner?.holder === holder && owner.projectId === app.resolve(ProjectRung.Current).projectId;
    },
  },
  {
    kind: OUTPUT_TAB,
    noun: 'terminal',
    view: () => import('./commands/OutputTab.svelte'),
    title: OutputTabTitle,
  },
];
