<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Sidebar } from '$lib/features/graph/sidebar/Sidebar.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  let { heading, count }: { heading: string; count: number } = $props();

  const sidebar = Sidebar.use();
</script>

<button
  type="button"
  class="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
  onclick={() => sidebar.toggleShelf(heading)}
  aria-expanded={sidebar.shelfOpen(heading)}
>
  <ChevronRight
    class={cn('size-3 shrink-0 transition-transform duration-150 ease-instrument', sidebar.shelfOpen(heading) && 'rotate-90')}
  />
  <span class="eyebrow">{heading}</span>
  <span class="stamp tabular ml-auto text-muted-foreground/60">{count}</span>
</button>
