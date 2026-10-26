<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { RadioChoice } from './radio.svelte.js';

  let {
    value = $bindable(),
    onValueChange,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { value?: string; onValueChange?: (value: string) => void } = $props();

  RadioChoice.make(
    () => value,
    (next) => {
      value = next;
      onValueChange?.(next);
    },
  );
</script>

<div {...rest} role="group" data-slot="dropdown-menu-radio-group">
  {@render children?.()}
</div>
