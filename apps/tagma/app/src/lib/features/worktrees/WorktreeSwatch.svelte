<script lang="ts">
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { ClassValue } from 'svelte/elements';
  import { toneOf } from './tone.js';

  let {
    row,
    size = 'sm',
    class: className = '',
  }: { row: Pick<WorktreePlace, 'hue' | 'kind'> | null; size?: 'sm' | 'md'; class?: ClassValue } = $props();

  const tone = $derived(toneOf(row));
  const main = $derived(row?.kind === 'main');
</script>

<span class={['inline-grid shrink-0 place-items-center', size === 'md' ? 'size-3' : 'size-2.5', className]} aria-hidden="true" data-swatch>
  <span
    class={[
      'grid rotate-45 place-items-center',
      size === 'md' ? 'size-2' : 'size-1.75',
      row === null
        ? 'border border-dashed border-muted-foreground'
        : main
          ? 'border border-muted-foreground'
          : tone === null && 'bg-muted-foreground',
    ]}
    style:background={main ? undefined : tone}
  >
    {#if main}<span class="size-0.75 bg-muted-foreground"></span>{/if}
  </span>
</span>
