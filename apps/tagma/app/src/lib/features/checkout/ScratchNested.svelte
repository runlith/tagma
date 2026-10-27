<script lang="ts">
  import { Live } from '$lib/wire/Live.js';
  import { insetOf } from './changeItem.js';
  import { ScratchFolder } from './ScratchFolder.svelte.js';
  import ScratchRows from './ScratchRows.svelte';

  let { projectId, thread, path, depth }: { projectId: number; thread: string; path: string; depth: number } = $props();

  const live = Live.use();

  let folder = $state.raw<ScratchFolder | null>(null);

  $effect(() => {
    const read = new ScratchFolder(live, projectId, thread, path);
    folder = read;
    return () => read.close();
  });
</script>

{#if folder?.refused != null}
  <p class="py-0.5 pr-2 text-small text-muted-foreground/70" style:padding-left="{insetOf(depth)}px">{folder.refused}</p>
{:else if folder?.frame != null}
  {#if folder.frame.total === 0}
    <p class="py-0.5 pr-2 text-small text-muted-foreground/60" style:padding-left="{insetOf(depth)}px">Empty</p>
  {:else}
    <ScratchRows frame={folder.frame} {projectId} {thread} {path} {depth} />
  {/if}
{/if}
