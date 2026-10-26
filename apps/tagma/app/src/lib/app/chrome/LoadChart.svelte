<script lang="ts">
  import { HISTORY_MS, type LoadPoint } from '@tagma/server/executions/contract/wire/load';
  import type { Layer, Lit } from '$lib/features/executions/load/rows.js';
  import LoadPlot from './LoadPlot.svelte';

  let {
    history,
    layers,
    lit,
    scale = 'fit',
  }: { history: readonly LoadPoint[]; layers: readonly Layer[]; lit: Lit; scale?: 'fit' | 'machine' } = $props();

  const SCALES = [0.02, 0.05, 0.1, 0.25, 0.5, 1] as const;

  const top = $derived.by(() => {
    if (scale === 'machine') return 1;
    const peak = Math.max(0, ...history.map((point) => point.own));
    return SCALES.find((one) => one >= peak * 1.05) ?? 1;
  });
  const collecting = $derived(history.length < 2);
</script>

<div class="grid gap-1" data-load-chart>
  <div class="relative h-14 overflow-hidden rounded-md bg-sunken">
    <LoadPlot class="absolute inset-0 size-full" {history} {layers} {lit} {top} />
    {#if collecting}
      <span class="absolute inset-0 grid place-items-center text-small text-muted-foreground">Collecting the first readings…</span>
    {/if}
  </div>
  {#if !collecting}
    <span class="flex justify-between font-mono text-meta text-muted-foreground">
      <span>−{HISTORY_MS / 60_000} min</span>
      <span>{scale === 'machine' ? 'now' : `${Math.round(top * 100)} % at top`}</span>
    </span>
  {/if}
</div>
