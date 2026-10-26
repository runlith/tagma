<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MenuIcon } from './row.js';

  let { icon: Icon, lead }: { icon?: MenuIcon | undefined; lead?: Snippet | undefined } = $props();
</script>

<span
  data-slot="dropdown-menu-lead"
  aria-hidden="true"
  class="grid size-3.5 shrink-0 place-items-center text-muted-foreground group-data-highlighted/menu-row:text-accent-foreground group-data-[state=open]/menu-row:text-accent-foreground group-data-[variant=destructive]/menu-row:text-destructive"
>
  {#if Icon}<Icon class="size-3.5" />{:else if lead}{@render lead()}{/if}
</span>
