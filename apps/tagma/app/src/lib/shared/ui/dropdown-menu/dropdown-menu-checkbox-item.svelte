<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import MinusIcon from '@lucide/svelte/icons/minus';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import RowLead from './dropdown-menu-lead.svelte';
  import { type BareLead, ROW } from './row.js';

  let {
    checked = $bindable(false),
    indeterminate = false,
    onCheckedChange,
    disabled = false,
    closeOnSelect,
    textValue,
    icon,
    lead,
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'onclick' | 'children'> & {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    children?: Snippet;
  } & BareLead = $props();

  const menu = Menu.use();

  function toggle(): void {
    checked = !checked;
    onCheckedChange?.(checked);
  }
</script>

<div
  {...rest}
  role="menuitemcheckbox"
  aria-checked={indeterminate ? 'mixed' : checked}
  aria-disabled={disabled || undefined}
  data-disabled={disabled ? '' : undefined}
  data-state={indeterminate ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
  data-slot="dropdown-menu-checkbox-item"
  class={cn(ROW, className)}
  {@attach menu.item(() => ({ disabled, closeOnSelect, textValue, onSelect: toggle }))}
>
  <RowLead {icon} {lead} />
  <FadeText class="flex-1">{@render children?.()}</FadeText>
  <span class="grid size-3.5 shrink-0 place-items-center" data-slot="dropdown-menu-checkbox-item-indicator">
    {#if indeterminate}
      <MinusIcon class="size-3.5" />
    {:else if checked}
      <CheckIcon class="size-3.5" />
    {/if}
  </span>
</div>
