<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';
  import { cn } from '$lib/shared/utils.js';

  let { class: className, ...restProps }: ComponentProps<typeof DialogPrimitive.Description> = $props();
</script>

<DialogPrimitive.Description
  class={cn('text-muted-foreground *:[a]:hover:text-foreground text-ui *:[a]:underline *:[a]:underline-offset-3', className)}
  {...restProps}
/>
