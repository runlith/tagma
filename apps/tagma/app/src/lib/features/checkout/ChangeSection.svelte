<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import type { Snippet } from 'svelte';
  import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
  import LineCount from './LineCount.svelte';

  let {
    fold,
    title,
    count,
    lines,
    shutByDefault = false,
    actsShown = false,
    acts,
    children,
  }: {
    fold: string;
    title: string;
    count?: string | number | undefined;
    lines?: CheckoutLines | undefined;
    shutByDefault?: boolean;
    actsShown?: boolean;
    acts?: Snippet;
    children: Snippet;
  } = $props();

  const marks = ReaderMarks.use();
  const mark = $derived(marks.foldedSides.get(fold));
  const open = $derived(mark === undefined ? !shutByDefault : mark !== 'shut');
</script>

<section class="group/section grid min-w-0 content-start" data-change-section={fold}>
  <div class="flex h-6 items-center gap-1 pr-2 pl-1">
    <h2 class="min-w-0 flex-1">
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-1 rounded-sm text-small font-semibold text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
        onclick={() => marks.foldedSides.set(fold, open ? 'shut' : 'open')}
      >
        <ChevronRight class={['size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90']} />
        <span class="truncate">{title}</span>
        {#if count !== undefined}
          <span class="font-medium tabular-nums text-muted-foreground/60">{count}</span>
        {/if}
      </button>
    </h2>
    {#if acts !== undefined}
      <span
        class={[
          'flex shrink-0 items-center gap-px transition-opacity duration-150 ease-instrument',
          !actsShown && 'opacity-0 group-hover/section:opacity-100 focus-within:opacity-100',
        ]}
      >
        {@render acts()}
      </span>
    {/if}
    {#if lines !== undefined}
      <span class="flex shrink-0 items-center gap-1.5 pr-1">
        <LineCount {lines} class="shrink-0" />
        <span class="w-3 shrink-0"></span>
      </span>
    {/if}
  </div>
  {#if open}
    <div class="grid min-w-0 gap-px px-1 pb-1">
      {@render children()}
    </div>
  {/if}
</section>
