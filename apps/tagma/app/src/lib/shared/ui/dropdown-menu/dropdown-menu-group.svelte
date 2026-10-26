<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { GroupHeading } from './heading.svelte.js';

  let { children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();

  const heading = GroupHeading.make();
</script>

<div aria-labelledby={heading.id} {...rest} role="group" data-slot="dropdown-menu-group">
  {@render children?.()}
</div>
