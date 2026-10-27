<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { clampFade } from '../clipFade';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let {
    id,
    lines,
    count = null,
    class: className = '',
    flush = false,
    actions,
    children,
  }: {
    id: string;
    lines: number;
    count?: string | null;
    class?: ClassValue;
    flush?: boolean;
    actions?: Snippet;
    children: Snippet;
  } = $props();

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
    <div class="min-w-0">{@render children()}</div>
  </div>
  {#if clipped || all || actions}
    <div class={[!flush && '-ml-1.5', 'flex min-w-0 items-center gap-1 font-sans text-small']}>
      {#if clipped || all}
        <button
          type="button"
          class="cursor-pointer rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-expanded={all}
          onclick={() => context.setExpanded(key, !all)}>{all ? strings.showLess() : strings.showAll()}</button
        >
        {#if count !== null}<span class="px-1.5 tabular-nums text-muted-foreground/60">{count}</span>{/if}
      {/if}
      {@render actions?.()}
    </div>
  {/if}
</div>

<style>
  .clamp {
    max-height: calc(var(--clamp-lines) * 1lh);
  }
</style>
