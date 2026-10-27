<script lang="ts">
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import { Live } from '$lib/wire/Live.js';
  import ChangeSection from './ChangeSection.svelte';
  import { insetOf } from './changeItem.js';
  import { ScratchFolder } from './ScratchFolder.svelte.js';
  import ScratchRows from './ScratchRows.svelte';

  let { projectId, thread }: { projectId: number; thread: string } = $props();

  const FOLD = 'thread-scratch';

  const marks = ReaderMarks.use();
  const live = Live.use();
  const open = $derived(marks.foldedSides.get(FOLD) !== 'shut');

  let folder = $state.raw<ScratchFolder | null>(null);

  $effect(() => {
    if (!open) return;
    const read = new ScratchFolder(live, projectId, thread, '');
    folder = read;
    return () => read.close();
  });

  const total = $derived(open ? folder?.frame?.total : undefined);
</script>

{#if !open || folder?.refused != null || (total ?? 0) > 0}
  <ChangeSection fold={FOLD} title="Scratch" count={total}>
    {#if folder?.refused != null}
      <p class="py-0.5 pr-2 text-small text-muted-foreground/70" style:padding-left="{insetOf(0)}px" data-scratch-refused>
        {folder.refused}
      </p>
    {:else if folder?.frame != null}
      <ScratchRows frame={folder.frame} {projectId} {thread} path="" depth={0} />
    {/if}
  </ChangeSection>
{/if}
