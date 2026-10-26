<script lang="ts">
  import { HISTORY_MS } from '@tagma/server/executions/contract/wire/load';
  import type { Spark } from '$lib/features/executions/load/rows.js';

  let { points, end }: { points: readonly Spark[]; end: number } = $props();

  const WIDTH = 56;
  const HEIGHT = 16;
  const FLOOR = 0.05;

  const shape = $derived.by(() => {
    if (points.length < 2) return null;
    const high = Math.max(FLOOR, ...points.map((point) => point.value));
    const start = end - HISTORY_MS;
    const x = (at: number) => ((Math.max(start, at) - start) / HISTORY_MS) * WIDTH;
    const y = (value: number) => HEIGHT - 1 - (value / high) * (HEIGHT - 2);
    const line = points.map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    return { line, area: `${x(points[0]!.at).toFixed(1)},${HEIGHT} ${line} ${WIDTH},${HEIGHT}` };
  });
</script>

<svg class="block h-4 w-14 shrink-0" viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
  {#if shape !== null}
    <polygon points={shape.area} class="fill-status-open/15" />
    <polyline
      points={shape.line}
      fill="none"
      stroke-width="1.2"
      vector-effect="non-scaling-stroke"
      stroke-linejoin="round"
      class="stroke-status-open"
    />
  {/if}
</svg>
