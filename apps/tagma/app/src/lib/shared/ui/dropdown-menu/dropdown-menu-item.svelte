<script lang="ts">
  import { Menu, type MenuItem } from '@runlith/primitives/menu.svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import RowLead from './dropdown-menu-lead.svelte';
  import RowTail from './dropdown-menu-tail.svelte';
  import { type Lead, ROW, type Tail, type Unstyled } from './row.js';

  let {
    class: className,
    variant = 'default',
    unstyled = false,
    disabled = false,
    closeOnSelect,
    textValue,
    onSelect,
    icon,
    lead,
    keys,
    current,
    hint,
    here,
    tail,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'onclick' | 'children'> &
    MenuItem & { variant?: 'default' | 'destructive'; children?: Snippet } & (({ unstyled?: false } & Lead & Tail) | Unstyled) = $props();

  const menu = Menu.use();
</script>

<div
  {...rest}
  role="menuitem"
  aria-disabled={disabled || undefined}
  data-disabled={disabled ? '' : undefined}
  data-slot="dropdown-menu-item"
  data-variant={variant}
  class={unstyled
    ? className
    : cn(
        ROW,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-hover-danger data-[variant=destructive]:data-highlighted:text-destructive',
        className,
      )}
  {@attach menu.item(() => ({ disabled, closeOnSelect, textValue, onSelect }))}
>
  {#if unstyled}
    {@render children?.()}
  {:else}
    <RowLead {icon} {lead} />
    {#if current || hint}
      <span data-line class="flex-1">
        <FadeText>{@render children?.()}</FadeText>
        <RowTail {current} {hint} />
      </span>
    {:else}
      <FadeText class="flex-1">{@render children?.()}</FadeText>
      <RowTail {keys} {here} {tail} />
    {/if}
  {/if}
</div>
