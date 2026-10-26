<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} role="presentation" data-slot="command-empty" class={cn('py-6 text-center text-ui', className)}>
  {@render children?.()}
</div>
