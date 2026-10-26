<script lang="ts">
  import { HISTORY_MS, type LoadPoint } from '@tagma/server/executions/contract/wire/load';
  import type { ClassValue } from 'svelte/elements';
  import type { Layer, Lit } from '$lib/features/executions/load/rows.js';

  let {
    history,
    layers,
    lit,
    top,
    class: className,
  }: { history: readonly LoadPoint[]; layers: readonly Layer[]; lit: Lit; top: number; class?: ClassValue } = $props();

  const WIDTH = 600;
  const HEIGHT = 56;

  const drawn = $derived.by(() => {
    if (history.length < 2) return null;
    const end = history[history.length - 1]!.at;
    const start = end - HISTORY_MS;
    const x = (at: number) => (((Math.max(start, at) - start) / HISTORY_MS) * WIDTH).toFixed(1);
    const y = (share: number) => (HEIGHT - Math.min(1, share / top) * (HEIGHT - 2)).toFixed(1);
    const line = (value: (point: LoadPoint) => number): string => history.map((point) => `${x(point.at)},${y(value(point))}`).join(' ');
    const band = (upper: (point: LoadPoint) => number, lower: (point: LoadPoint) => number): string =>
      [
        ...history.map((point) => `${x(point.at)},${y(upper(point))}`),
        ...history.toReversed().map((point) => `${x(point.at)},${y(lower(point))}`),
      ].join(' ');
    const below = (index: number) => (point: LoadPoint) =>
      layers.slice(0, index).reduce((sum, layer) => sum + (point.rows[layer.key] ?? 0), 0);
    const layered = below(layers.length);
    const row = lit?._tag === 'Row' ? lit.key : null;
    const ofRow = (point: LoadPoint) => (row === null ? 0 : (point.rows[row] ?? 0));
    return {
      machine: band(
        (point) => point.machine ?? 0,
        () => 0,
      ),
      own: band((point) => Math.max(point.own, layered(point)), layered),
      edge: layers.length === 0 ? line((point) => point.own) : null,
      layers: layers.map((layer, index) => ({
        ...layer,
        points: band((point) => below(index)(point) + (point.rows[layer.key] ?? 0), below(index)),
      })),
      row: row === null ? null : { area: band(ofRow, () => 0), line: line(ofRow) },
    };
  });

  const dimmed = $derived(lit?._tag === 'Layer' || lit?._tag === 'Row');
</script>

<svg class={className} viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
  {#if drawn !== null}
    <polygon points={drawn.machine} class="fill-muted-foreground/25" />
    <polygon
      points={drawn.own}
      class={[drawn.edge === null ? 'fill-muted-foreground/60' : 'fill-brand/35', 'transition-opacity', dimmed ? 'opacity-25' : '']}
    />
    {#if drawn.edge !== null}
      <polyline
        points={drawn.edge}
        fill="none"
        stroke-width="1.25"
        vector-effect="non-scaling-stroke"
        stroke-linejoin="round"
        class={['stroke-brand transition-opacity', dimmed ? 'opacity-25' : '']}
      />
    {/if}
    {#each drawn.layers as layer (layer.key)}
      <polygon
        points={layer.points}
        class={[
          layer.fill,
          'transition-opacity',
          lit === null || (lit._tag === 'Layer' && lit.key === layer.key) ? 'opacity-80' : 'opacity-25',
        ]}
      />
    {/each}
    {#if drawn.row !== null}
      <polygon points={drawn.row.area} class="fill-foreground/20" />
      <polyline
        points={drawn.row.line}
        fill="none"
        stroke-width="1.25"
        vector-effect="non-scaling-stroke"
        stroke-linejoin="round"
        class="stroke-foreground"
      />
    {/if}
  {/if}
</svg>
