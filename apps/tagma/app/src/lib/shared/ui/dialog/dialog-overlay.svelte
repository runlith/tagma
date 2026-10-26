<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';
  import { cn } from '$lib/shared/utils.js';

  let { ref = $bindable(null), class: className, ...restProps }: ComponentProps<typeof DialogPrimitive.Overlay> = $props();
</script>

<DialogPrimitive.Overlay
  bind:ref
  data-slot="dialog-overlay"
  class={cn('bg-scrim supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate', className)}
  {...restProps}
/>
