import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import type { PaneKind } from '$lib/shared/panes/pane.js';
import { holderThread } from '$lib/shared/panes/holder.js';
import { paneThread, THREAD_PANE } from './seats/pane.js';
import ThreadOffer from './seats/ThreadOffer.svelte';
import ThreadTitle from './seats/ThreadTitle.svelte';
import WorkOffer from './work/WorkOffer.svelte';
import { WORK_PANE } from './work/workPane.js';
import WorkTitle from './work/WorkTitle.svelte';

export const panes: readonly PaneKind[] = [
  {
    kind: THREAD_PANE,
    noun: 'thread',
    view: () => import('./seats/ThreadPane.svelte'),
    title: ThreadTitle,
    keep: true,
    moves: true,
    offer: { order: 90, view: ThreadOffer },
    admits: (id, holder) => {
      const { threadId } = paneThread(id);
      return threadId === null || threadId !== holderThread(holder);
    },
    stands: (app, id) => {
      const { home, threadId } = paneThread(id);
      if (threadId === null) return true;
      const words = app.resolve(ThreadNames).of(threadId, home === null ? undefined : String(home));
      return words === undefined ? null : words !== null;
    },
  },
  {
    kind: WORK_PANE,
    noun: 'work',
    view: () => import('./work/WorkPane.svelte'),
    title: WorkTitle,
    offer: { order: 26, view: WorkOffer },
  },
];
