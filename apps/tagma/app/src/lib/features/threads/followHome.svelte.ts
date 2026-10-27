import { untrack } from 'svelte';
import type { ThreadAddress } from '$lib/features/workspace/ShellOps.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';

export function followHome(host: ThreadSlot, moved: (thread: ThreadAddress) => void): void {
  let followed: string | null = null;
  $effect(() => {
    const shown = host.activeThread;
    const home = shown?.projectId ?? null;
    if (shown === null || home === null || home === host.projectId || shown.id !== host.activeId) return;
    const move = `${shown.id}:${home}`;
    if (followed === move) return;
    followed = move;
    untrack(() => moved({ projectId: home, threadId: shown.id }));
  });
}
