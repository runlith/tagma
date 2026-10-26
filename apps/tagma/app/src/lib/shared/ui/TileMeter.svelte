<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  let {
    count,
    lit,
    fill = 'var(--muted-foreground)',
    track = 'filled',
    class: className,
  }: {
    count: number;
    lit: number;
    fill?: string;
    track?: 'filled' | 'outlined' | 'none';
    class?: ClassValue;
  } = $props();

  const slots = $derived(Array.from({ length: count }, (_, index) => index));
  const empty = $derived(track === 'filled' ? 'bg-vein-strong' : track === 'outlined' ? 'border border-vein-strong' : '');
</script>

<span class={['flex shrink-0 items-center gap-px', className]} aria-hidden="true" data-tiles>
  {#each slots as index (index)}
    {#if index < lit}
      <i class="block size-0.75" style:background={fill} data-lit></i>
    {:else}
      <i class={['block size-0.75', empty]}></i>
    {/if}
  {/each}
</span>
