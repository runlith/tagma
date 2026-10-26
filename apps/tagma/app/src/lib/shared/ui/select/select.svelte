<script lang="ts">
  import { Select } from '@runlith/primitives/select.svelte';
  import type { Snippet } from 'svelte';

  let {
    value = $bindable(''),
    onValueChange,
    disabled = false,
    children,
  }: { value?: string; onValueChange?: (value: string) => void; disabled?: boolean; children: Snippet } = $props();

  const id = $props.id();

  Select.make(
    id,
    () => value,
    (next) => {
      if (value === next) return;
      value = next;
      onValueChange?.(next);
    },
    () => disabled,
    { align: 'start', sideOffset: 4 },
  );
</script>

{@render children()}
