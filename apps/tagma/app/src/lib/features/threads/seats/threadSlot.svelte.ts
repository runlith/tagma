import { App } from '@runlith/layer/svelte/App.svelte';
import { untrack } from 'svelte';
import { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { holdProject } from '$lib/features/workspace/holds.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import type { SidePane } from '$lib/shared/panes/pane.js';
import { followThread } from './followThread.svelte.js';
import { paneThread } from './pane.js';
import type { ThreadSeats } from './ThreadSeats.svelte.js';

export type ThreadPaneSlot = { readonly host: ThreadSlot; readonly home: number | null; readonly projectId: number };

export function threadSlot(seats: ThreadSeats, pane: () => SidePane): ThreadPaneSlot {
  const key = untrack(() => pane().key);
  const home = untrack(() => paneThread(pane().id).home);
  const projectId = home ?? ProjectRung.Current.use().projectId;
  const addresses = Addresses.use();
  if (home !== null) holdProject(home);
  const host = ThreadSlot.start(App.section(`beside-${key}`, 'project'), {
    app: App.current(),
    pane: key,
    writer: seats.writerOf(key),
    context: { scopeName: () => (home === null ? addresses.scope : null) },
  });
  followThread(seats, pane, host, projectId);
  return { host, home, projectId };
}
