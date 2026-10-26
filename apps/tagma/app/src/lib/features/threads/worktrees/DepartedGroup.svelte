<script lang="ts">
  import { Finishing } from '$lib/features/worktrees/Finishing.svelte.js';
  import OutcomeLine from '$lib/features/worktrees/OutcomeLine.svelte';

  const finishing = Finishing.use();
</script>

{#if finishing.departed.length > 0}
  <div class="mt-1.5 grid gap-1 px-1.5 py-1" data-worktree-departed={finishing.departed.length}>
    {#each finishing.departed as outcome (outcome.id)}
      <OutcomeLine {outcome} named />
    {/each}
  </div>
{/if}
