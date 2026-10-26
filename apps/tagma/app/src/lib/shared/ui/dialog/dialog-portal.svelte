<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import type { ComponentProps } from 'svelte';

  let { ...restProps }: ComponentProps<typeof DialogPrimitive.Portal> = $props();
</script>

<DialogPrimitive.Portal {...restProps} />
