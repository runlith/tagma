<script lang="ts">
  import ChangesList from './ChangesList.svelte';
  import DiffStage from './DiffStage.svelte';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  const LIST = 288;
  const DIFF_MIN = 480;

  const changes = ThreadChanges.use();

  let width = $state(0);
  const split = $derived(width >= LIST + DIFF_MIN);
  const file = $derived(changes.open);
  const covered = $derived(file !== null && !split);
</script>

<div class="relative flex h-full min-h-0 min-w-0" bind:clientWidth={width} data-changes={split ? 'split' : 'stacked'}>
  <div
    class={['min-h-0 min-w-0', file !== null && split ? 'shrink-0 border-r' : 'flex-1']}
    style:width={file !== null && split ? `${LIST}px` : undefined}
    style:visibility={covered ? 'hidden' : undefined}
    inert={covered}
  >
    <ChangesList />
  </div>
  {#if file !== null}
    <div class={split ? 'min-h-0 min-w-0 flex-1' : 'absolute inset-0 min-h-0 min-w-0'} data-changes-diff>
      <DiffStage {file} onBack={split ? undefined : () => (changes.open = null)} />
    </div>
  {/if}
</div>
