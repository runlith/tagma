<script lang="ts">
  let { waiting = 0, failed = 0, working = 0 }: { waiting?: number; failed?: number; working?: number } = $props();

  const parts = $derived(
    [
      { count: waiting, state: 'waiting', ink: 'text-status-open', tile: 'bg-status-open' },
      { count: failed, state: 'failed', ink: 'text-destructive', tile: 'bg-destructive' },
      { count: working, state: 'working', ink: 'text-status-in-work', tile: 'bg-status-in-work' },
    ].filter((part) => part.count > 0),
  );
  const label = $derived(parts.map((part) => `${part.count} ${part.state}`).join(', '));
</script>

{#if parts.length > 0}
  <span
    class="flex shrink-0 items-center gap-1.5 text-meta leading-none font-medium tabular"
    role="img"
    aria-label={label}
    data-agent-counts
  >
    {#each parts as part (part.state)}
      <span class={['flex items-center gap-0.5', part.ink]} data-count={part.state}
        ><i class={['block size-1.25 shrink-0', part.tile]}></i>{part.count}</span
      >
    {/each}
  </span>
{/if}
