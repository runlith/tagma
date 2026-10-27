<script lang="ts">
  import type { Snippet } from 'svelte';
  import { clampFade } from '../clipFade';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let {
    id,
    lines,
    count = null,
    class: className = '',
    children,
  }: { id: string; lines: number; count?: string | null; class?: string; children: Snippet } = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const key = $derived(`${id}:all`);
  const all = $derived(context.expanded(key));
  let clipped = $state(false);
</script>

<div class={['grid min-w-0 gap-1', className]} style:--clamp-lines={lines}>
  <div
    class={['min-w-0', !all && 'clamp']}
    data-clamp={all ? undefined : ''}
    {@attach all ? undefined : clampFade((value) => (clipped = value))}
  >
    {@render children()}
  </div>
  {#if clipped || all}
    <div class="-ml-1.5 flex min-w-0 items-baseline gap-2 font-sans text-small">
      <button
        type="button"
        class="cursor-pointer rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        aria-expanded={all}
        onclick={() => context.setExpanded(key, !all)}>{all ? strings.showLess() : strings.showAll()}</button
      >
      {#if count !== null}<span class="tabular-nums text-muted-foreground/60">{count}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .clamp {
    max-height: calc(var(--clamp-lines) * 1lh);
  }
</style>
