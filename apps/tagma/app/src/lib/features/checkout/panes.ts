import type { PaneKind } from '$lib/shared/panes/pane.js';
import ChangesOffer from './ChangesOffer.svelte';
import ChangesTitle from './ChangesTitle.svelte';
import CommitPaneTitle from './CommitPaneTitle.svelte';
import FileOffer from './FileOffer.svelte';
import FileTitle from './FileTitle.svelte';
import { CHANGES_PANE, COMMIT_PANE, FILE_PANE } from './paneContent.js';

export const panes: readonly PaneKind[] = [
  {
    kind: CHANGES_PANE,
    noun: 'changes',
    view: () => import('./ChangesPane.svelte'),
    title: ChangesTitle,
    offer: { order: 25, view: ChangesOffer },
  },
  {
    kind: FILE_PANE,
    noun: 'file',
    view: () => import('./FilePane.svelte'),
    title: FileTitle,
    offer: { order: 10, view: FileOffer },
  },
  {
    kind: COMMIT_PANE,
    noun: 'commit',
    portable: true,
    view: () => import('./CommitPane.svelte'),
    title: CommitPaneTitle,
  },
];
