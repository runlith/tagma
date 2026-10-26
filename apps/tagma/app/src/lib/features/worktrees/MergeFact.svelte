<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import Check from '@lucide/svelte/icons/check';
  import type { WorktreeRow } from '@tagma/server/worktrees/contract/wire/rows';
  import FactStamp from './FactStamp.svelte';

  let { row }: { row: WorktreeRow } = $props();
</script>

<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small" data-worktree-merge={row.mergeFact.state}>
  {#if row.mergeFact.state !== 'untaken'}
    {#if row.check === 'clean'}
      <span class={['inline-flex items-center gap-1', row.mergeFact.state === 'current' ? 'text-status-done' : 'text-muted-foreground']}>
        <Check class="size-3.5" />clean
      </span>
    {:else if row.check === 'conflicts'}
      <span class="inline-flex items-center gap-1 text-destructive"><AlertTriangle class="size-3.5" />conflicts</span>
    {:else if row.check === 'format-behind'}
      <span class="text-muted-foreground">format pending</span>
    {:else if row.mergeFact.state === 'current'}
      <span class="text-muted-foreground">unknown</span>
    {/if}
  {/if}
  <FactStamp fact={row.mergeFact} head={row.head} />
</span>
