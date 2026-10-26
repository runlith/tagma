<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';

  let { open = $bindable(false), ...restProps }: ComponentProps<typeof DialogPrimitive.Root> = $props();
</script>

<DialogPrimitive.Root bind:open {...restProps} />
