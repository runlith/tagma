<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import RowLead from './dropdown-menu-lead.svelte';
  import { type Lead, ROW } from './row.js';

  let {
    class: className,
    unstyled = false,
    disabled = false,
    textValue,
    icon,
    lead,
    current,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'onclick' | 'children'> & {
    disabled?: boolean;
    textValue?: string;
    children?: Snippet;
  } & (
      | ({ unstyled?: false; current?: string | null | undefined } & Lead)
      | { unstyled: true; icon?: undefined; lead?: undefined; current?: undefined }
    ) = $props();

  const sub = Menu.use();
</script>

<div
  {...rest}
  role="menuitem"
  aria-haspopup="menu"
  aria-expanded={sub.open}
  aria-controls={sub.open ? sub.id : undefined}
  aria-disabled={disabled || undefined}
  data-disabled={disabled ? '' : undefined}
  data-state={sub.open ? 'open' : 'closed'}
  data-slot="dropdown-menu-sub-trigger"
  class={unstyled ? className : cn(ROW, 'data-[state=open]:bg-selected data-[state=open]:text-accent-foreground', className)}
  {@attach sub.subTrigger(() => ({ disabled, textValue }))}
>
  {#if unstyled}
    {@render children?.()}
  {:else}
    <RowLead {icon} {lead} />
    <FadeText class="flex-1">{@render children?.()}</FadeText>
    {#if current}
      <FadeText data-slot="dropdown-menu-current" class="max-w-1/2 shrink-0 text-muted-foreground" text={current} />
    {/if}
    <ChevronRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
  {/if}
</div>
