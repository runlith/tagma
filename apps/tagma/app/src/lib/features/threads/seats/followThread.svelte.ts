import { untrack } from 'svelte';
import type { SidePane } from '$lib/shared/panes/pane.js';
import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
import { paneThread } from './pane.js';
import type { ThreadSeats } from './ThreadSeats.svelte.js';

export function followThread(seats: ThreadSeats, pane: () => SidePane, host: ThreadSlot, projectId: number): void {
  const key = untrack(() => pane().key);
  host.activateRoute(
    untrack(() => paneThread(pane().id).threadId),
    projectId,
  );
  $effect(() => seats.seat(key, host));
  $effect(() => {
    const thread = paneThread(pane().id).threadId;
    untrack(() => host.activateRoute(thread, projectId));
  });
}
