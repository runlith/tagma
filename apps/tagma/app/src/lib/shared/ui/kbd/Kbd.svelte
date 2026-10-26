<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { chordKeys } from '$lib/shared/chordSpelling.js';
  import { cn } from '$lib/shared/utils.js';

  let { chord, size = 'md', class: className }: { chord: string; size?: 'sm' | 'md'; class?: ClassValue } = $props();

  const keys = $derived(chordKeys(chord));
</script>

<span class="inline-flex shrink-0 items-center gap-0.5 align-middle">
  {#each keys as key, index (index)}
    <kbd
      class={cn(
        'inline-flex items-center justify-center rounded-sm bg-selected px-1 font-sans text-meta leading-none font-medium whitespace-nowrap text-foreground/80 tabular-nums',
        size === 'md' ? 'h-4.5 min-w-4.5' : 'h-4 min-w-4',
        className,
      )}>{key}</kbd
    >
  {/each}
</span>
