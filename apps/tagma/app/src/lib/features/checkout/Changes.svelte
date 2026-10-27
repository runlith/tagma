<script lang="ts">
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import ChangesList from './ChangesList.svelte';
  import DiffStage from './DiffStage.svelte';
  import { CHANGES_SEAM } from './seams.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  const changes = ThreadChanges.use();
  const seams = Seams.use();

  const seam = new Seam(seams.seam(CHANGES_SEAM), { onCommit: (size) => seams.set(CHANGES_SEAM, size) });
  const file = $derived(changes.open);
</script>

<div class="flex h-full min-h-0 min-w-0">
  <div class="min-h-0 shrink-0 border-r" style:width="{seam.size}px">
    <ChangesList />
  </div>
  <SeamHandle {seam} label="Resize the changes list" contained />
  <div class="min-h-0 min-w-0 flex-1" data-changes-diff>
    {#if file !== null}
      <DiffStage {file} />
    {:else if !changes.empty || changes.lens === 'base'}
      <p class="grid h-full place-items-center px-6 text-center text-ui text-muted-foreground" data-changes-pick>
        Select a file to see its diff
      </p>
    {/if}
  </div>
</div>
