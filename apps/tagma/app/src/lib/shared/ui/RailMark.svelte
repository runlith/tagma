<script lang="ts">
  import { cn } from '$lib/shared/utils.js';

  let { current, edge = 'left' }: { current: boolean; edge?: 'left' | 'bottom' } = $props();
</script>

<span
  class={cn(
    'absolute bg-brand transition-all',
    edge === 'left'
      ? cn('-left-1.5 w-0.75', current ? 'h-5' : 'h-0 group-hover:h-2 group-hover:opacity-50')
      : cn('-bottom-1 left-1/2 h-0.75 -translate-x-1/2', current ? 'w-5' : 'w-0'),
  )}
  aria-hidden="true"
></span>
