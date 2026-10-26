<script lang="ts">
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    onOpenChange,
    children,
  }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: Snippet } = $props();

  const id = $props.id();

  Menu.sub(
    id,
    () => open,
    (next) => {
      if (open === next) return;
      open = next;
      onOpenChange?.(next);
    },
  );
</script>

{@render children()}
