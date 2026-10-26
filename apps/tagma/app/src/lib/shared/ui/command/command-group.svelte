<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let { heading, class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { heading?: string } = $props();

  const id = $props.id();
</script>

<div
  {...rest}
  role="group"
  aria-labelledby={heading === undefined ? undefined : id}
  data-slot="command-group"
  class={cn('overflow-hidden p-1 text-foreground', className)}
>
  {#if heading !== undefined}
    <div {id} role="presentation" class="px-2 py-1.5 text-small font-semibold text-muted-foreground">{heading}</div>
  {/if}
  {@render children?.()}
</div>
