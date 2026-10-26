<script lang="ts" module>
  export type BadgeTone = 'plain' | 'open' | 'stale' | 'failed' | 'work';

  const TONE: Record<BadgeTone, string> = {
    plain: 'bg-current',
    open: 'bg-status-open',
    stale: 'bg-status-stale',
    failed: 'bg-destructive',
    work: 'bg-status-in-work',
  };

  const CAP = 99;
  const GAP = 2;

  function round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  function notch(target: HTMLElement, mark: HTMLElement): string | undefined {
    const width = target.offsetWidth;
    const height = target.offsetHeight;
    if (width === 0 || height === 0) return undefined;
    const box = target.getBoundingClientRect();
    const scale = box.width / width;
    const at = mark.getBoundingClientRect();
    const x = round((at.left - box.left) / scale - GAP);
    const y = round((at.top - box.top) / scale - GAP);
    const w = round(at.width / scale + 2 * GAP);
    const h = round(at.height / scale + 2 * GAP);
    const r = round(Math.min(parseFloat(getComputedStyle(mark).borderTopLeftRadius) + GAP, w / 2, h / 2));
    const outer = `M${-width} ${-height}H${2 * width}V${2 * height}H${-width}Z`;
    const hole = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    return `path(evenodd, "${outer} ${hole}")`;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let {
    count = 0,
    dot = false,
    tone = 'plain',
    class: className,
    children,
  }: { count?: number; dot?: boolean; tone?: BadgeTone; class?: ClassValue; children: Snippet } = $props();

  let target = $state<HTMLElement | null>(null);
  let mark = $state<HTMLElement | null>(null);
  let width = $state(0);
  let cut = $state<string | undefined>();

  $effect(() => {
    cut = target === null || mark === null || width === 0 ? undefined : notch(target, mark);
  });
</script>

<span bind:this={target} class="grid" style:clip-path={cut}>{@render children()}</span>
{#if count > 0}
  <span
    bind:this={mark}
    bind:clientWidth={width}
    class={['pointer-events-none absolute grid h-2.75 min-w-2.75 place-items-center rounded-sm px-0.5', TONE[tone], className]}
    aria-hidden="true"><span class="text-badge font-semibold text-chrome tabular-nums">{count > CAP ? `${CAP}+` : count}</span></span
  >
{:else if dot}
  <span
    bind:this={mark}
    bind:clientWidth={width}
    class={cn('pointer-events-none absolute size-1.5', TONE[tone], className)}
    aria-hidden="true"
  ></span>
{/if}
