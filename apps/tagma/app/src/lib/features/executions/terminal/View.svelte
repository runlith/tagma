<script lang="ts">
  import { Host } from '@runlith/layer/Host';
  import { onDestroy, untrack } from 'svelte';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import type { ExecutionAddress } from '../Repo.js';
  import type { PaneSource } from './Pane.svelte.js';
  import PaneHost from './PaneHost.svelte';
  import { TerminalViews } from './Views.svelte.js';

  let {
    key,
    projectId,
    address,
    program,
    source,
    cwd = null,
    class: className,
  }: {
    key: string;
    projectId: number;
    address: ExecutionAddress;
    program: string;
    source: PaneSource;
    cwd?: string | null;
    class?: string;
  } = $props();

  const isMac = Host.use().apple;
  const workspace = Workspace.use();
  const lease = untrack(() =>
    TerminalViews.use().lease(key, { projectId, root: cwd ?? workspace.find(projectId)?.rootPath ?? '', address, program, source }),
  );
  onDestroy(() => lease.release());
</script>

<div class={['relative flex min-h-0 overflow-hidden', className]} data-terminal-view={key}>
  <PaneHost pane={lease.pane} {isMac} active={false} />
</div>
