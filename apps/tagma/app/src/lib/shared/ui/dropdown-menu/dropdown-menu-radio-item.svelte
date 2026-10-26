<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import RowLead from './dropdown-menu-lead.svelte';
  import { RadioChoice } from './radio.svelte.js';
  import { type BareLead, ROW } from './row.js';

  let {
    value,
    disabled = false,
    closeOnSelect,
    textValue,
    unstyled = false,
    icon,
    lead,
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'onclick' | 'children'> & {
    value: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    unstyled?: boolean;
    children?: Snippet;
  } & BareLead = $props();

  const menu = Menu.use();
  const choice = RadioChoice.use();
  const checked = $derived(choice.value === value);
</script>

<div
  {...rest}
  role="menuitemradio"
  aria-checked={checked}
  aria-disabled={disabled || undefined}
  data-disabled={disabled ? '' : undefined}
  data-state={checked ? 'checked' : 'unchecked'}
  data-slot="dropdown-menu-radio-item"
  class={unstyled ? className : cn(ROW, className)}
  {@attach menu.item(() => ({ disabled, closeOnSelect, textValue, onSelect: () => choice.choose(value) }))}
>
  {#if unstyled}
    {@render children?.()}
  {:else}
    <RowLead {icon} {lead} />
    <FadeText class="flex-1">{@render children?.()}</FadeText>
    <span class="grid size-3.5 shrink-0 place-items-center" data-slot="dropdown-menu-radio-item-indicator">
      {#if checked}<CheckIcon class="size-3.5" />{/if}
    </span>
  {/if}
</div>
