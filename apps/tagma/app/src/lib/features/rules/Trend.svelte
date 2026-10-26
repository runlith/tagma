<script lang="ts">
  import type { HistoryPoint } from '@tagma/server/enforcement/contract/wire/engines';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { cn } from '$lib/shared/utils.js';
  import { agoSaid } from '$lib/shared/time.js';

  let {
    history,
    was,
    total,
  }: {
    history: readonly HistoryPoint[];
    was: { readonly count: number; readonly until: string } | null;
    total: number;
  } = $props();

  const series = $derived([...[...history].reverse().map((one) => one.count), total]);

  const moves = $derived(series.filter((count, at) => at === 0 || count !== series[at - 1]).length - 1);

  const spark = $derived.by(() => {
    if (moves < 2) return null;
    const top = Math.max(1, ...series);
    const step = 100 / (series.length - 1);
    const xy = series.map((count, at) => [Number((at * step).toFixed(1)), Number((26 - (count / top) * 24).toFixed(1))] as const);
    return { points: xy.map(([x, y]) => `${x},${y}`).join(' '), last: xy[xy.length - 1] ?? [100, 26] };
  });
</script>

{#if was !== null && was.count !== total}
  <span class={cn('inline-flex items-center gap-1 text-small', was.count < total ? 'text-severity-lie' : 'text-status-verified')}>
    {#if was.count < total}<ArrowUp class="size-3" />{:else}<ArrowDown class="size-3" />{/if}
    from {was.count}, {agoSaid(was.until)}
  </span>
{/if}
{#if spark}
  <span class="inline-flex items-center text-muted-foreground" title={`Over its last ${series.length - 1} changes: ${series.join(' → ')}`}>
    <svg viewBox="0 0 100 28" class="h-4 w-16 overflow-visible" aria-hidden="true">
      <polyline points={spark.points} fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" />
      <circle cx={spark.last[0]} cy={spark.last[1]} r="2" fill="currentColor" />
    </svg>
  </span>
{/if}
