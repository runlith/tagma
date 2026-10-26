<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';

  let { type = 'button', ...restProps }: ComponentProps<typeof DialogPrimitive.Close> = $props();
</script>

<DialogPrimitive.Close {type} {...restProps} />
