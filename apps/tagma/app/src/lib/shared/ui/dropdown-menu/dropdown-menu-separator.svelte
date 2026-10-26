<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let { class: className, unstyled = false, ...rest }: HTMLAttributes<HTMLDivElement> & { unstyled?: boolean } = $props();
</script>

<div
  {...rest}
  role="separator"
  aria-orientation="horizontal"
  data-slot="dropdown-menu-separator"
  class={unstyled ? className : cn('-mx-1 my-1 h-px bg-border', className)}
></div>
