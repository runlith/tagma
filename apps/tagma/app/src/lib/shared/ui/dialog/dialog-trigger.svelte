<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';

  let { ref = $bindable(null), type = 'button', ...restProps }: ComponentProps<typeof DialogPrimitive.Trigger> = $props();
</script>

<DialogPrimitive.Trigger bind:ref data-slot="dialog-trigger" {type} {...restProps} />
