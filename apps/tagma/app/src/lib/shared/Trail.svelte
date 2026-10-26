<script lang="ts" module>
  type Part = { readonly kind: 'step'; readonly index: number } | { readonly kind: 'fold'; readonly indices: readonly number[] };

  const FLOOR = 6;
  const SEPARATOR = 1.5;

  function partsOf(widths: readonly number[], room: number): readonly Part[] {
    const count = widths.length;
    const cost = (index: number): number => Math.min(widths[index]!, FLOOR);
    const shown = count > 1 ? [0, count - 1] : count === 1 ? [0] : [];
    let spent = shown.reduce((sum, index) => sum + cost(index), 0);
    const middle: number[] = [];
    for (let index = count - 2; index >= 1; index--) middle.push(index);
    let taken = 0;
    while (taken < middle.length) {
      const next = middle[taken]!;
      const separators = shown.length + (taken + 1 < middle.length ? 2 : 0);
      if (spent + cost(next) + separators * SEPARATOR > room) break;
      spent += cost(next);
      shown.push(next);
      taken++;
    }
    shown.sort((a, b) => a - b);
    const folded = middle.slice(taken).sort((a, b) => a - b);
    const parts: Part[] = shown.map((index) => ({ kind: 'step', index }));
    if (folded.length > 0) parts.splice(1, 0, { kind: 'fold', indices: folded });
    return parts;
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { cn } from './utils.js';

  let {
    steps,
    step,
    folded,
    class: className,
  }: {
    steps: readonly T[];
    step: Snippet<[T]>;
    folded: Snippet<[readonly T[]]>;
    class?: string;
  } = $props();

  let element = $state<HTMLElement>();
  let width = $state(Number.POSITIVE_INFINITY);
  let em = $state(16);
  let measured = $state.raw<{ readonly steps: readonly T[]; readonly widths: readonly number[] } | null>(null);

  const widths = $derived(measured !== null && measured.steps === steps ? measured.widths : null);
  const parts = $derived<readonly Part[]>(
    widths === null ? steps.map((_, index) => ({ kind: 'step', index })) : partsOf(widths, width / em),
  );
  const columns = $derived(
    parts
      .map(
        (part, at) =>
          (at === 0 ? '' : 'auto ') + (part.kind === 'fold' ? 'auto' : widths === null ? 'max-content' : 'minmax(0, max-content)'),
      )
      .join(' '),
  );

  $effect(() => {
    if (element === undefined || widths !== null) return;
    em = parseFloat(getComputedStyle(element).fontSize);
    const cells = element.querySelectorAll<HTMLElement>(':scope > [data-step]');
    measured = { steps, widths: Array.from(cells, (cell) => cell.getBoundingClientRect().width / em) };
  });
</script>

<nav
  bind:this={element}
  bind:clientWidth={width}
  class={cn('grid min-w-0 grid-flow-col items-center justify-start gap-1 overflow-hidden', className)}
  style:grid-template-columns={columns}
>
  {#each parts as part, at (part.kind === 'step' ? part.index : -1)}
    {#if at > 0}<span class="px-0.5 text-muted-foreground/45" aria-hidden="true">/</span>{/if}
    {#if part.kind === 'step'}
      <div class="min-w-0" data-step>{@render step(steps[part.index]!)}</div>
    {:else}
      {@render folded(part.indices.map((index) => steps[index]!))}
    {/if}
  {/each}
</nav>
