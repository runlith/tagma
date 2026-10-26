<script lang="ts">
  import { Popover, type HoverIntent } from '@runlith/primitives/popover.svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { hover, children, ...rest }: HTMLButtonAttributes & { hover?: HoverIntent } = $props();

  const popover = Popover.use();
</script>

<button
  type="button"
  {...rest}
  data-slot="popover-trigger"
  aria-haspopup="dialog"
  aria-expanded={popover.open}
  aria-controls={popover.open ? popover.id : undefined}
  data-state={popover.open ? 'open' : 'closed'}
  {@attach popover.trigger}
  {@attach hover && popover.hover(hover)}
>
  {@render children?.()}
</button>
