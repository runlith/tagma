<script lang="ts">
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { children, ...rest }: HTMLButtonAttributes = $props();

  const menu = Menu.use();
</script>

<button
  type="button"
  {...rest}
  data-slot="dropdown-menu-trigger"
  aria-haspopup="menu"
  aria-expanded={menu.open}
  aria-controls={menu.open ? menu.id : undefined}
  data-state={menu.open ? 'open' : 'closed'}
  {@attach menu.trigger}
>
  {@render children?.()}
</button>
