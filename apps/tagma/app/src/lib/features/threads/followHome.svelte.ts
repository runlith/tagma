import { untrack } from 'svelte';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { ThreadAddress } from '$lib/features/workspace/ShellOps.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';

export function followHome(host: ThreadSlot, workspace: Workspace, moved: (thread: ThreadAddress, home: Project) => void): void {
  let followed: string | null = null;
  $effect(() => {
    const shown = host.activeThread;
    const home = shown?.projectId ?? null;
    if (shown === null || home === null || home === host.projectId || shown.id !== host.activeId) return;
    const project = workspace.find(home);
    if (project === null) return;
    const move = `${shown.id}:${home}`;
    if (followed === move) return;
    followed = move;
    untrack(() => moved({ projectId: home, threadId: shown.id }, project));
  });
}
