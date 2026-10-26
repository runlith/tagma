<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '../utils.js';
  import { tabLook } from './tab.js';

  let { selected, class: className, children, ...rest }: HTMLButtonAttributes & { selected: boolean } = $props();
</script>

<button type="button" role="tab" aria-selected={selected} class={cn(tabLook(selected), 'h-6 shrink-0 gap-1.5 px-2', className)} {...rest}
  >{@render children?.()}</button
>
