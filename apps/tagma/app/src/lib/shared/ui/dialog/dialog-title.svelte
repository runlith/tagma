<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';
  import { cn } from '$lib/shared/utils.js';

  let { class: className, ...restProps }: ComponentProps<typeof DialogPrimitive.Title> = $props();
</script>

<DialogPrimitive.Title class={cn('text-page leading-tight font-semibold', className)} {...restProps} />
